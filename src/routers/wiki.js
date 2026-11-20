import * as cheerio from "cheerio";
import { Feed } from "feed";

const WIKI_HOST = "seesaawiki.jp";

function absoluteUrl(value, base) {
    if (!value) return "";
    try {
        const url = new URL(value, base);
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
        return "";
    }
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function parseDate(value) {
    const match = String(value || "").match(
        /(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})日?/
    );
    if (!match) return null;
    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() !== Number(month) - 1 ||
        date.getUTCDate() !== Number(day)
    ) return null;
    return date;
}

function extractNumber(value) {
    const text = String(value || "");
    const fc2 = text.match(/\bFC2\s*PPV\s*\d+\b/i);
    if (fc2) return fc2[0].replace(/\s+/g, " ").toUpperCase();
    const match = text.match(/\b[A-Z0-9]{2,}(?:-[A-Z0-9]+)+\b/i);
    return match ? match[0].toUpperCase() : "";
}

function getEntryChunks(bodyHtml) {
    return String(bodyHtml || "")
        .split(/<br\s*\/?>\s*(?:\r?\n\s*)*<br\s*\/?>/i)
        .map(chunk => chunk.trim())
        .filter(Boolean);
}

export async function wiki(model, baseUrl) {
    const input = String(model || "").trim();
    if (!input) {
        throw new Error("请在 wiki 参数中提供 Seesaa Wiki 演员资料页 URL");
    }

    let pageUrl;
    try {
        pageUrl = new URL(input);
    } catch {
        throw new Error("wiki 参数必须是完整的 https://seesaawiki.jp 页面 URL");
    }

    if (
        pageUrl.protocol !== "https:" ||
        pageUrl.hostname !== WIKI_HOST ||
        !pageUrl.pathname.startsWith("/w/")
    ) {
        throw new Error("目前只支持 https://seesaawiki.jp/w/ 下的 Wiki 页面");
    }
    pageUrl.hash = "";

    const response = await fetch(pageUrl.href, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml"
        }
    });

    if (!response.ok) {
        throw new Error(`Seesaa Wiki HTTP Error: ${response.status}`);
    }

    const html = new TextDecoder("euc-jp").decode(await response.arrayBuffer());
    const $ = cheerio.load(html);

    const actorName =
        $("#page-header h2").first().clone().children().remove().end().text().trim() ||
        $("h1").first().text().trim() ||
        $("title").text().replace(/\s*-\s*素人系総合\s*wiki\s*$/i, "").trim() ||
        pageUrl.pathname.split("/").pop();

    const currentRssUrl = `${baseUrl}?wiki=${encodeURIComponent(pageUrl.href)}`;

    const feed = new Feed({
        title: `${actorName} - Wiki作品更新`,
        description: `素人系総合 Wiki：${actorName} 的作品资料更新`,
        id: pageUrl.href,
        link: pageUrl.href,
        language: "ja",
        favicon: "https://seesaawiki.jp/favicon.ico",
        feedLinks: { rss: currentRssUrl },
        updated: new Date()
    });

    const seen = new Set();
    const sections = $(".wiki-section-body-1, .wiki-section-body-2");

    sections.each((_, body) => {
        const section = $(body).closest(".wiki-section-1, .wiki-section-2");
        const category = section.find("h3, h4").first().text().trim() || "作品";
        if (/^(SNS|プロフィール)$/.test(category)) return;

        for (const chunk of getEntryChunks($(body).html())) {
            const $chunk = cheerio.load(chunk);
            const anchors = $chunk("a[href]");

            const titleAnchor = anchors.filter((__, anchor) => {
                const a = $chunk(anchor);
                return !a.find("img").length &&
                    !/^\s*[（(]レーベル一覧[）)]\s*$/.test(a.text().trim());
            }).first();

            if (!titleAnchor.length) continue;

            const title = titleAnchor.text().trim();
            const link = absoluteUrl(titleAnchor.attr("href"), pageUrl.href);
            if (!title || !link || seen.has(link)) continue;
            seen.add(link);

            const imageAnchor = anchors.filter((__, anchor) => $chunk(anchor).find("img").length).first();
            let image = "";
            if (imageAnchor.length) {
                const imageHref = imageAnchor.attr("href") || "";
                const imageSrc = imageAnchor.find("img").attr("src") || "";
                const candidate = /(?:^|\/)[^/]*_files\//i.test(imageHref)
                    ? imageSrc
                    : imageHref || imageSrc;
                image = absoluteUrl(candidate, pageUrl.href);
            }

            const leadingText = $chunk.root().contents()
                .filter((__, node) => node.type === "text")
                .first().text().trim();
            const fullText = $chunk.root().text().replace(/\s+/g, " ").trim();
            const dateText = (leadingText || fullText).match(
                /\d{4}[./年-]\d{1,2}(?:[./月-]\d{1,2}日?)?(?:発売予定)?/
            )?.[0] || "";
            const number = extractNumber(leadingText) || extractNumber(fullText);
            const date = parseDate(dateText);

            const description = [
                `<p>分类：${escapeHtml(category)}</p>`,
                dateText ? `<p>日期：${escapeHtml(dateText)}</p>` : "",
                number ? `<p>番号：${escapeHtml(number)}</p>` : "",
                image ? `<p><img src="${escapeHtml(image)}" alt="${escapeHtml(title)}"></p>` : ""
            ].filter(Boolean).join("\n");

            const item = {
                id: link,
                link,
                title,
                description,
                content: `<div><p>分类：${escapeHtml(category)}</p>${dateText ? `<p>日期：${escapeHtml(dateText)}</p>` : ""}${number ? `<p>番号：${escapeHtml(number)}</p>` : ""}${image ? `<p><img src="${escapeHtml(image)}" alt="${escapeHtml(title)}"></p>` : ""}<p><a href="${escapeHtml(link)}">查看作品页面</a></p></div>`,
                author: [{ name: actorName }],
                category: [{ name: category }]
            };

            if (date) item.date = date;
            feed.addItem(item);
        }
    });

    if (!seen.size) {
        throw new Error("页面中没有找到可识别的作品条目，请确认这是演员作品资料页");
    }

    return feed.rss2();
}
