function normalizeBaseUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function getPublicSiteConfig(request: Request) {
  const configuredAppUrl = process.env.SHOPIFY_APP_URL;
  const baseUrl = normalizeBaseUrl(configuredAppUrl || new URL(request.url).origin);

  return {
    appName: "Profit Guard",
    baseUrl,
    supportEmail: process.env.PROFIT_GUARD_SUPPORT_EMAIL || "256658163@qq.com",
  };
}

export function buildPublicUrl(baseUrl: string, pathname: string) {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${baseUrl}${normalizedPath}`;
}
