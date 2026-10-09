/** Tiny markdown renderer for owner-edited policy content (no HTML passthrough). */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" class="text-forest-800 underline underline-offset-4">$1</a>');
}

export function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  let inQuote = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  const closeQuote = () => {
    if (inQuote) {
      out.push("</blockquote>");
      inQuote = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) {
      closeList();
      closeQuote();
      out.push(`<h3 class="mt-6 mb-2 text-lg font-semibold text-forest-900">${inline(line.replace(/^###\s+/, ""))}</h3>`);
    } else if (/^##\s+/.test(line)) {
      closeList();
      closeQuote();
      out.push(`<h2 class="mt-8 mb-3 text-xl font-semibold text-forest-900">${inline(line.replace(/^##\s+/, ""))}</h2>`);
    } else if (/^#\s+/.test(line)) {
      closeList();
      closeQuote();
      out.push(`<h2 class="mt-8 mb-3 text-xl font-semibold text-forest-900">${inline(line.replace(/^#\s+/, ""))}</h2>`);
    } else if (/^>\s?/.test(line)) {
      closeList();
      if (!inQuote) {
        out.push(`<blockquote class="my-4 rounded-xl border-l-4 border-gold-600 bg-gold-200/30 px-4 py-3 text-sm italic text-bark-700">`);
        inQuote = true;
      }
      out.push(`<p class="mb-1">${inline(line.replace(/^>\s?/, ""))}</p>`);
    } else if (/^[-*]\s+/.test(line)) {
      closeQuote();
      if (!inList) {
        out.push(`<ul class="my-3 list-disc space-y-1 pl-6">`);
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else if (line.trim() === "") {
      closeList();
      closeQuote();
    } else {
      closeList();
      closeQuote();
      out.push(`<p class="my-3 leading-relaxed">${inline(line)}</p>`);
    }
  }
  closeList();
  closeQuote();
  return out.join("\n");
}
