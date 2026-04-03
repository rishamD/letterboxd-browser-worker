import "dotenv/config";
import http from "http";
import {
    SQSClient,
    ReceiveMessageCommand,
    DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import {
    DynamoDBClient,
    PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { initBrowser, scrapeWithBrowser } from "./scraper.js";

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION });

const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE;

// ----------------------------------------------------------------------------------
// WRITE TO DYNAMODB
// ----------------------------------------------------------------------------------
async function writeResult(username, status, films = null) {
    const item = {
        username: { S: username },
        status: { S: status },
        updatedAt: { S: new Date().toISOString() },
    };

    if (films) {
        item.films = {
            L: films.map((f) => ({
                M: {
                    slug: { S: f.slug },
                    rating: { N: String(f.rating ?? 0) },
                },
            })),
        };
    }

    await dynamo.send(
        new PutItemCommand({
            TableName: DYNAMODB_TABLE,
            Item: item,
        })
    );
}

// ----------------------------------------------------------------------------------
// PROCESS A SINGLE SQS MESSAGE
// ----------------------------------------------------------------------------------
async function processMessage(username) {
    console.log(`Processing username: ${username}`);

    try {
        await writeResult(username, "processing");

        const films = await scrapeWithBrowser(username);

        await writeResult(username, "complete", films);

        console.log(`✅ Done: ${username} — ${films.length} films scraped`);
    } catch (err) {
        console.error(`❌ Failed to scrape ${username}:`, err);
        await writeResult(username, "error");
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

            if (messages.length === 0) {
                continue;
            }

            for (const message of messages) {
                const body = JSON.parse(message.Body);
                const username = body.username?.trim();
                
                if (!username) {
                    console.warn("Empty message body, skipping...");
                    continue;
                }

                await processMessage(username);

                await sqs.send(
                    new DeleteMessageCommand({
                        QueueUrl: SQS_QUEUE_URL,
                        ReceiptHandle: message.ReceiptHandle,
                    })
                );
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