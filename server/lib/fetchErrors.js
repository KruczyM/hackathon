export function describeFetchError(error, url = "") {
  const parts = [error?.message || "fetch failed"];
  const cause = error?.cause;
  const causeBits = [
    cause?.code,
    cause?.name,
    cause?.message,
    cause?.hostname ? `host=${cause.hostname}` : "",
    cause?.address ? `address=${cause.address}` : "",
    cause?.port ? `port=${cause.port}` : ""
  ].filter(Boolean);
  if (causeBits.length) parts.push(`cause: ${causeBits.join(" ")}`);
  if (url) {
    try {
      parts.push(`url: ${new URL(url).origin}`);
    } catch {
      parts.push(`url: ${url}`);
    }
  }
  return [...new Set(parts)].join(" / ");
}
