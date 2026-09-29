/** Marker reading copies sometimes contain unescaped spaces in standalone image paths. */
export function normalizeMarkdownImages(markdown: string): string {
  let fence: string | null = null;
  return markdown.split("\n").map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (fence && marker[1]![0] === fence[0] && marker[1]!.length >= fence.length) fence = null;
      else if (!fence) fence = marker[1]!;
      return line;
    }
    if (fence) return line;
    return line.replace(/^( {0,3}!\[[^\]\n]*\]\()([^<>\n]+\.(?:apng|avif|bmp|gif|jpe?g|jfif|png|svg|tiff?|webp))(\)\s*)$/i,
      (_match, start: string, destination: string, end: string) => `${start}<${destination.trim()}>${end}`);
  }).join("\n");
}
