import { MockApiServer, MockServerOptions } from './server';

async function main(): Promise<void> {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;

  const serverOptions = {
    port,
    minDelayMs: 200,
    maxDelayMs: 500,
    failureRate: 0.1,
    seedInitialData: true,
    autoProgressStatus: true,
    autoProgressIntervalMs: 2500,
  } satisfies MockServerOptions;

  const server = new MockApiServer(serverOptions);
  const baseUrl = await server.start();

  console.log(`========================================================`);
  console.log(`🚀 Insurtech Mock API Server running at ${baseUrl}`);
  console.log(
    `   - Simulated latency: ${serverOptions.minDelayMs}ms - ${serverOptions.maxDelayMs}ms`
  );
  console.log(
    `   - Simulated transient 503 failure rate: ${Math.round(serverOptions.failureRate * 100)}%`
  );
  console.log(
    `   - Seeded initial claim: ${serverOptions.seedInitialData ? 'CLM-001' : 'none'}`
  );
  console.log(
    `   - Auto status progression: ${
      serverOptions.autoProgressStatus
        ? `enabled (${serverOptions.autoProgressIntervalMs / 1000}s interval)`
        : 'disabled'
    }`
  );
  console.log(`========================================================`);

  const shutdown = async () => {
    console.log('\nShutting down Mock API Server...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
