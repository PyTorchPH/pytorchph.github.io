export function assertDevelopmentRuntime(environment = process.env) {
  if (environment.NODE_ENV === "production" || environment.VERCEL || environment.CI) {
    throw new Error("Local automatic access is unavailable in production, Vercel, or CI.");
  }
}

export function developmentBrowserOptions(executablePath) {
  return {
    executablePath,
    headless: false,
    viewport: null,
    args: ["--no-first-run", "--no-default-browser-check", "--start-maximized"],
  };
}

export function assertLocalUrl(raw, label, allowedHosts) {
  if (!raw) throw new Error(`${label} is required.`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must use an approved loopback host.`);
  }
  const approved = allowedHosts.some((host) => (
    url.hostname === host || (host === "localhost" && url.hostname.endsWith(".localhost"))
  ));
  if (url.protocol !== "http:" || !approved) {
    throw new Error(`${label} must use an approved loopback host.`);
  }
  return url;
}
