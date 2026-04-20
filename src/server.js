import "dotenv/config";
import http from "http";
import {
    SQSClient,
    ReceiveMessageCommand,
    DeleteMessageCommand,
    SendMessageCommand,
} from "@aws-sdk/client-sqs";
import {
    DynamoDBClient,
    PutItemCommand,
    GetItemCommand,
    UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { initBrowser, closeBrowser, scrapePage } from "./scraper.js";

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION });

const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;
const USER_COUNTS_TABLE = "deepcut-user-counts";
const FILMS_PER_PAGE = 72;

// ----------------------------------------------------------------------------------
// DYNAMO HELPERS
// ----------------------------------------------------------------------------------

async function getUserRatingCount(username) {
    try {
        const res = await dynamo.send(
            new GetItemCommand({
                TableName: USER_COUNTS_TABLE,
                Key: { user_id: { S: username } },
                ProjectionExpression: "rating_count",
            })
        );
        const val = res.Item?.rating_count?.N;
        return val ? parseInt(val, 10) : 0;
    } catch (err) {
        console.warn(`Could not fetch rating_count for ${username}:`, err);
        return 0;
    }
}

async function getExistingFilms(username) {
    try {
        const res = await dynamo.send(
            new GetItemCommand({
                TableName: DYNAMODB_TABLE,
                Key: { username: { S: username } },
                ProjectionExpression: "films",
            })
        );
        return res.Item?.films?.L ?? [];
    } catch (err) {
        console.warn(`Could not fetch existing films for ${username}:`, err);
        return [];
    }
}

function serializeFilms(films) {
    return films.map((f) => ({
        M: {
            slug: { S: f.slug },
            title: { S: f.title ?? "" },
            rating: { N: String(f.rating ?? 0) },
        },
    }));
}

async function writeStatus(username, status) {
    await dynamo.send(
        new UpdateItemCommand({
            TableName: DYNAMODB_TABLE,
            Key: { username: { S: username } },
            UpdateExpression: "SET #s = :s, updatedAt = :u",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
                ":s": { S: status },
                ":u": { S: new Date().toISOString() },
            },
        })
    );
}

/**
 * Merges new films into the existing films list in DynamoDB.
 * New films on page 1 are prepended; duplicates are removed by slug.
 */
async function mergeAndWriteFilms(username, newFilms, updateMeta = true) {
    const existingRaw = await getExistingFilms(username);

    const existingFilms = existingRaw.map((f) => ({
    slug: f.M.slug.S,
    title: f.M.title?.S ?? "",
    rating: parseFloat(f.M.rating.N),
    }));

    const filmMap = new Map(existingFilms.map((f) => [f.slug, f]));
    for (const film of newFilms) {
        filmMap.set(film.slug, film);
    }
    const merged = Array.from(filmMap.values());

    if (updateMeta) {
        // Initial job — write status + updatedAt so the client sees it
        await dynamo.send(
            new PutItemCommand({
                TableName: DYNAMODB_TABLE,
                Item: {
                    username: { S: username },
                    status: { S: "complete" },
                    updatedAt: { S: new Date().toISOString() },
                    films: { L: serializeFilms(merged) },
                },
            })
        );
    } else {
        // Background page job — only update films, leave status/updatedAt alone
        await dynamo.send(
            new UpdateItemCommand({
                TableName: DYNAMODB_TABLE,
                Key: { username: { S: username } },
                UpdateExpression: "SET films = :f",
                ExpressionAttributeValues: {
                    ":f": { L: serializeFilms(merged) },
                },
            })
        );
    }

    console.log(
        `✅ Wrote ${merged.length} total films for ${username} ` +
        `(${newFilms.length} new/updated, updateMeta=${updateMeta})`
    );
}

// ----------------------------------------------------------------------------------
// SQS HELPERS
// ----------------------------------------------------------------------------------

async function queuePageJob(username, page) {
    await sqs.send(
        new SendMessageCommand({
            QueueUrl: SQS_QUEUE_URL,
            MessageBody: JSON.stringify({ username, page }),
        })
    );
    console.log(`📨 Queued page job: ${username} page ${page}`);
}

// ----------------------------------------------------------------------------------
// PROCESS INITIAL JOB (no page number — figures out what needs scraping)
// ----------------------------------------------------------------------------------

async function processInitialJob(username, alreadyScraped) {
    console.log(
        `🔍 Initial job for ${username}, already_scraped=${alreadyScraped}`
    );

    await writeStatus(username, "processing");

    const { films: page1Films, totalPages } = await scrapePage(username, 1);

    console.log(
        `📄 ${username} has ${totalPages} total pages, ` +
        `${alreadyScraped} already scraped, page 1 returned ${page1Films.length} films`
    );

    // Write complete immediately after page 1 — client can now get results
    await mergeAndWriteFilms(username, page1Films, true);

    if (totalPages === 1) {
        console.log(`✅ ${username} only has 1 page, done.`);
        return { success: true, shouldDelete: true };
    }

    const scrapedPages = Math.floor(alreadyScraped / FILMS_PER_PAGE);
    const pagesToQueue = [];
    for (let p = 2; p <= totalPages; p++) {
        if (p > scrapedPages) pagesToQueue.push(p);
    }

    console.log(
        `📨 Queueing ${pagesToQueue.length} background page jobs for ` +
        `${username}: pages ${pagesToQueue.join(", ")}`
    );

    for (const p of pagesToQueue) {
        await queuePageJob(username, p);
    }

    return { success: true, shouldDelete: true };
}

// ----------------------------------------------------------------------------------
// PROCESS PAGE JOB (specific page number)
// ----------------------------------------------------------------------------------

async function processPageJob(username, page) {
    console.log(`📄 Background page job for ${username} page ${page}`);

    const { films } = await scrapePage(username, page);

    // updateMeta=false — silently merge, don't touch status or updatedAt
    await mergeAndWriteFilms(username, films, false);

    console.log(
        `✅ Merged ${films.length} films from ${username} page ${page}`
    );

    return { success: true, shouldDelete: true };
}

// ----------------------------------------------------------------------------------
// REINITIALIZE BROWSER
// ----------------------------------------------------------------------------------

async function reinitializeBrowser() {
    console.log("Reinitializing browser...");
    try {
        await closeBrowser();
    } catch (err) {
        console.warn("Error while closing browser:", err);
    }
    await initBrowser();
}

// ----------------------------------------------------------------------------------
// ROUTE MESSAGE
// ----------------------------------------------------------------------------------

async function processMessage(body) {
    const { username, page, already_scraped } = body;

    if (!username) throw new Error("Missing username in message body");

    try {
        if (page) {
            // Specific page job
            return await processPageJob(username, page);
        } else {
            // Initial job — fetch already_scraped from message or fall back to DB
            const scraped =
                already_scraped ?? (await getUserRatingCount(username));
            return await processInitialJob(username, scraped);
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message.includes("404") || message.includes("not found")) {
            await writeStatus(username, "not_found");
            return { success: false, shouldDelete: true };
        }

        if (message.includes("403")) {
            await writeStatus(username, "error");
            console.warn(`403 detected for ${username}, reinitializing browser...`);
            try {
                await reinitializeBrowser();
            } catch (reinitErr) {
                console.error("Failed to reinitialize browser:", reinitErr);
            }
            return { success: false, shouldDelete: false };
        }

        await writeStatus(username, "error");
        return { success: false, shouldDelete: false };
    }
}

// ----------------------------------------------------------------------------------
// SQS POLLING LOOP
// ----------------------------------------------------------------------------------

async function poll() {
    console.log("Polling SQS for messages...");

    while (true) {
        try {
            const response = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: SQS_QUEUE_URL,
                    MaxNumberOfMessages: 1,
                    WaitTimeSeconds: 20,
                })
            );

            const messages = response.Messages ?? [];
            if (messages.length === 0) continue;

            for (const message of messages) {
                let body = null;

                try {
                    body = JSON.parse(message.Body);

                    if (!body?.username) {
                        console.warn("Message missing username, deleting...");
                        await sqs.send(
                            new DeleteMessageCommand({
                                QueueUrl: SQS_QUEUE_URL,
                                ReceiptHandle: message.ReceiptHandle,
                            })
                        );
                        continue;
                    }

                    const result = await processMessage(body);

                    if (result.shouldDelete) {
                        await sqs.send(
                            new DeleteMessageCommand({
                                QueueUrl: SQS_QUEUE_URL,
                                ReceiptHandle: message.ReceiptHandle,
                            })
                        );
                        console.log(
                            `🗑️ Deleted message for ${body.username}${body.page ? ` page ${body.page}` : ""}`
                        );
                    } else {
                        console.warn(
                            `⚠️ Leaving message in queue for retry: ${body.username}`
                        );
                    }
                } catch (err) {
                    console.error(
                        `Error handling message${body?.username ? ` for ${body.username}` : ""}:`,
                        err
                    );
                    console.warn("Message not deleted, will return to queue.");
                }
            }
        } catch (err) {
            console.error("SQS polling error:", err);
            await new Promise((res) => setTimeout(res, 5000));
        }
    }
}

// ----------------------------------------------------------------------------------
// HEALTH CHECK SERVER
// ----------------------------------------------------------------------------------

const PORT = process.env.PORT ?? 8081;

const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200);
        res.end("OK");
    } else {
        res.writeHead(404);
        res.end("Not found");
    }
});

server.listen(PORT, "0.0.0.0", async () => {
    console.log(`🚀 Health check server running on port ${PORT}`);
    try {
        await initBrowser();
        poll();
    } catch (err) {
        console.error("Failed to initialize browser:", err);
        process.exit(1);
    }
});