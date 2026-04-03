import "dotenv/config";
import {
    SQSClient,
    ReceiveMessageCommand,
    DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import {
    DynamoDBClient,
    PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { scrapeWithBrowser } from "./scraper.js";

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
async function processMessage(message) {
    const username = message.Body?.trim();

    if (!username) {
        console.warn("Received empty message body, skipping...");
        return;
    }

    console.log(`Processing username: ${username}`);

    try {
        // Mark as processing in DynamoDB
        await writeResult(username, "processing");

        // Scrape the profile
        const films = await scrapeWithBrowser(username);

        // Write results to DynamoDB
        await writeResult(username, "complete", films);

        console.log(
            `Done: ${username} — ${films.length} films scraped`
        );
    } catch (err) {
        console.error(`Failed to scrape ${username}:`, err);

        // Write error status so frontend doesn't poll forever
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
                    WaitTimeSeconds: 20, // Long polling — reduces empty responses
                })
            );

            const messages = response.Messages ?? [];

            if (messages.length === 0) {
                console.log("No messages, continuing to poll...");
                continue;
            }

            for (const message of messages) {
                await processMessage(message);

                // Delete message from SQS after successful processing
                await sqs.send(
                    new DeleteMessageCommand({
                        QueueUrl: SQS_QUEUE_URL,
                        ReceiptHandle: message.ReceiptHandle,
                    })
                );
            }
        } catch (err) {
            console.error("SQS polling error:", err);
            // Wait 5 seconds before retrying to avoid hammering on error
            await new Promise((res) => setTimeout(res, 5000));
        }
    }
}

// ----------------------------------------------------------------------------------
// HEALTH CHECK (Required for ASG / load balancer)
// ----------------------------------------------------------------------------------
import http from "http";

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

server.listen(PORT, () => {
    console.log(`Health check server running on port ${PORT}`);
    poll(); // Start SQS polling after server is up
});