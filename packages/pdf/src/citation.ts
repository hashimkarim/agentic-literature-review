export function citationPageSearchOrder(requestedPage: number, pageCount: number): number[] {
  const order = [requestedPage, requestedPage - 1, requestedPage + 1];
  for (let page = 1; page <= pageCount; page += 1) order.push(page);
  return [...new Set(order.filter((page) => page >= 1 && page <= pageCount))];
}
