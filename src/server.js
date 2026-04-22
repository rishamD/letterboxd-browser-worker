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
    UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { initBrowser, scrapePage, refreshContext } from "./scraper.js";

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION });

const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

// ----------------------------------------------------------------------------------
// DYNAMO HELPERS
// ----------------------------------------------------------------------------------

function serializeFilms(films) {
    return films.map((f) => ({
        M: {
            slug: { S: f.slug },
            title: { S: f.displayName ?? f.title ?? "" },
            rating: { N: String(f.rating ?? 0) },
        },
    }));
}

async function mergeAndWriteFilms(username, newFilms, updateMeta = true) {
    const serialized = serializeFilms(newFilms);

    if (updateMeta) {
        await dynamo.send(
            new PutItemCommand({
                TableName: DYNAMODB_TABLE,
                Item: {
                    username: { S: username },
                    status: { S: "complete" },
                    updatedAt: { S: new Date().toISOString() },
                    films: { L: serialized },
                },
            })
        );
    } else {
        await dynamo.send(
            new UpdateItemCommand({
                TableName: DYNAMODB_TABLE,
                Key: { username: { S: username } },
                UpdateExpression:
                    "SET films = list_append(if_not_exists(films, :empty_list), :f)",
                ExpressionAttributeValues: {
                    ":f": { L: serialized },
                    ":empty_list": { L: [] },
                },
            })
        );
    }
}

// ----------------------------------------------------------------------------------
// SEQUENTIAL MESSAGE PROCESSING
// ----------------------------------------------------------------------------------

async function processMessage(message) {
    const body = JSON.parse(message.Body);
    const { username, page } = body;

    console.log(
        `📥 Processing: ${username} ${page ? `(p${page})` : "(Initial Job)"}`
    );

    try {
        if (page) {
            const { films } = await scrapePage(username, page);
            await mergeAndWriteFilms(username, films, false);
        } else {
            const { films, totalPages } = await scrapePage(username, 1);
            await mergeAndWriteFilms(username, films, true);

            for (let p = 2; p <= totalPages; p++) {
                await sqs.send(
                    new SendMessageCommand({
                        QueueUrl: SQS_QUEUE_URL,
                        MessageBody: JSON.stringify({ username, page: p }),
                    })
                );
            }
        }

        await sqs.send(
            new DeleteMessageCommand({
                QueueUrl: SQS_QUEUE_URL,
                ReceiptHandle: message.ReceiptHandle,
            })
        );

        console.log(
            `✅ Finished: ${username} ${page ? `p${page}` : "Initial"}`
        );
    } catch (err) {
        if (err.message === "403_BLOCKED") {
            throw err;
        }
        console.error(`❌ Error processing ${username}:`, err.message);
    }
}

async function poll() {
    console.log("👂 Polling SQS for one job at a time...");

    while (true) {
        try {
            const response = await sqs.send(
                new ReceiveMessageCommand({
                    QueueUrl: SQS_QUEUE_URL,
                    MaxNumberOfMessages: 1,
                    WaitTimeSeconds: 20,
                })
            );

            if (response.Messages && response.Messages.length > 0) {
                try {
                    await processMessage(response.Messages[0]);
                } catch (processErr) {
                    if (processErr.message === "403_BLOCKED") {
                        console.log("♻️ Refreshing context after 403 block...");
                        await refreshContext();
                    }
                }
            }
        } catch (err) {
            console.error("SQS Polling Error:", err);
            await new Promise((r) => setTimeout(r, 5000));
        }
    }
}

// ----------------------------------------------------------------------------------
// SERVER STARTUP
// ----------------------------------------------------------------------------------

const server = http.createServer((req, res) => {
    if (req.url === "/health") {
        res.writeHead(200);
        res.end("OK");
    }
});

server.listen(8081, "0.0.0.0", async () => {
    console.log("🚀 Scraper Service Live on Port 8081");
    await initBrowser();
    poll();
});