# Actian VectorAI DB

## Installing the JavaScript SDK

The Actian VectorAI JavaScript client is published as `@actian/vectorai-client`.
Install it with npm:

```bash
npm install @actian/vectorai-client
```

The package works in Node.js and TypeScript projects. TypeScript type
declarations ship with the package, so no separate `@types` install is needed.

## Connecting a client

Construct a client against the gRPC endpoint, which listens on port 6574 by
default:

```typescript
import { VectorAIClient } from '@actian/vectorai-client';

const client = new VectorAIClient('localhost:6574');
await client.healthCheck();
```

Call `client.close()` when finished. The client also exposes `connect()` and an
`isConnected` property.

## Running the server in Docker

The server image is `actian/vectorai`. It requires the EULA environment variable
to be set before it will start:

```bash
docker run -p 6573:6573 -p 6574:6574 -p 6575:6575 \
  -e ACTIAN_VECTORAI_ACCEPT_EULA=YES actian/vectorai:latest
```

Three ports are exposed. Port 6573 serves the authentication and admin REST API,
port 6574 serves gRPC, and port 6575 serves the data REST API and the local web
UI. The documented minimum is 8 GB of RAM, with 16 GB or more recommended.

## Creating a collection and searching

Collections are created with a fixed dimension and distance metric. The
dimension must match the embedding model that will write into it, and it cannot
be changed afterwards.

```typescript
await client.collections.create('answer_memory_v1', {
  dimension: 384,
  distanceMetric: 'COSINE',
});

await client.points.upsert('answer_memory_v1', [
  { id: 1, vector: embedding, payload: { tenantId: 'demo' } },
]);

const hits = await client.points.search('answer_memory_v1', queryVector, {
  limit: 3,
  withPayload: true,
});
```

Point IDs are numbers or strings. Search returns `{ id, score, payload }`.

## Payload field indexes

Payload field indexes are not currently implemented in the JavaScript client.
Filtered search performs a full scan over payloads, which is acceptable at small
collection sizes but should be considered when planning for scale.
