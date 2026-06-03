const browserGlobal = globalThis as unknown as {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

browserGlobal.process ??= {};
browserGlobal.process.env ??= {};
