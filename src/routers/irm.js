import * as cheerio from "cheerio";
import { Feed } from "feed";

const SOURCE_URL =
    "https://irm.avlabo.com/archives/mogami_ichika.php";

const ACTOR_PATH = "/archives/mogami_ichika.php";

function absoluteUrl(url) {
    if (!url) return "";
    try {
        return new URL(url, SOURCE_URL).href;
    } catch {
        return "";
    }
}

function parseDate(value) {
    const match = String(value || "").match(
        /(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})/
    );

    if (!match) return null;

    const [, year, month, day] = match;
    const date = new Date(Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day)
    ));

    if (
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() !== Number(month) - 1 ||
        date.getUTCDate() !== Number(day)
    ) {
        return null;
    }

    return date;
}

export async function irm(model, baseUrl) {
    const currentRssUrl =
        `${baseUrl}?irm=${encodeURIComponent(model || "mogami_ichika")}`;

    const requestHeaders = {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml"
    };

    const pages = [SOURCE_URL];
    const visitedPages = new Set();
    const pageDocuments = [];
    const maxPages = 10;

    while (pages.length && visitedPages.size < maxPages) {
        const pageUrl = pages.shift();
        if (visitedPages.has(pageUrl)) continue;
        visitedPages.add(pageUrl);

        const response = await fetch(pageUrl, { headers: requestHeaders });
        if (!response.ok) {
            if (pageUrl === SOURCE_URL) {
                throw new Error(`IRMLabo HTTP Error: ${response.status}`);
            }
            continue;
        }

        const pageHtml = await response.text();
        const page = cheerio.load(pageHtml);
        pageDocuments.push(page);

        const paginationLinks = page(
            "a[rel='next'], .pagination a, .pager a, .pagenavi a, " +
            ".page-numbers, nav[aria-label*='pagination'] a, " +
            "[class*='pagination'] a, [class*='pager'] a, " +
            "[id*='pagination'] a, [id*='pager'] a"
        );

        paginationLinks.each((_, anchor) => {
            const href = page(anchor).attr("href");
            if (!href) return;

            try {
                const nextUrl = new URL(href, pageUrl);
                const sourceUrl = new URL(SOURCE_URL);

                if (
                    nextUrl.origin !== sourceUrl.origin ||
                    nextUrl.pathname !== sourceUrl.pathname
                ) {
                    return;
                }

                const normalizedUrl = nextUrl.href;
                if (!visitedPages.has(normalizedUrl) && !pages.includes(normalizedUrl)) {
                    pages.push(normalizedUrl);
                }
            } catch {
                // Ignore malformed pagination links.
            }
        });
    }

    const feed = new Feed({
        title: "最上一花作品更新",
        description: "IRMLabo - 最上一花作品列表",
        id: SOURCE_URL,
        link: SOURCE_URL,
        language: "ja",
        favicon: "https://irm.avlabo.com/favicon.ico",
        feedLinks: {
            rss: currentRssUrl
        },
        updated: new Date()
    });

    const seen = new Set();

    // 入口本身就是最上一花的专属列表页，因此不再按演员链接二次过滤。
    // 同时遍历分页页面中的所有 article，并通过 seen 去重。
    for (const $ of pageDocuments) {
        $("article").each((_, element) => {
            const article = $(element);
            const thumb = article.find(".thumb_link").first();
            if (!thumb.length) return;
    
            const title = thumb
                .find(".thumb_link_ttl")
                .first()
                .text()
                .trim();
    
            const link = absoluteUrl(
                thumb.children("a").first().attr("href")
            );
    
            const img = thumb.find(".thumb_link_img img").first();
            const image = absoluteUrl(
                img.attr("data-src") ||
                img.attr("data-original") ||
                img.attr("src") ||
                img.attr("data-lazy-src")
            );
    
            const dateText = article
                .find(".thumb_link_date")
                .first()
                .text()
                .trim();
    
            const date = parseDate(dateText);

            // IRMLabo marks the numeric star rating with <span class="text-danger">.
            const ratingText = article.find("span.text-danger").first().text().trim();
            const ratingMatch = ratingText.match(/\d+(?:\.\d+)?/);
            const rating = ratingMatch ? Number(ratingMatch[0]) : null;
    
            if (!title || !link || seen.has(link)) return;
            seen.add(link);
    
            const ratingHtml = rating !== null
                ? `<p>⭐ 评分：${rating}</p>`
                : "";

            const content = `
                <div>
                    <p>演员：最上一花</p>
                    <p>作品：${title}</p>
                    ${ratingHtml}
                    <p>发行日期：${dateText || "未知"}</p>
                    ${image ? `<p><img src="${image}" alt="${title}" /></p>` : ""}
                </div>
            `;

            const item = {
                id: link,
                link,
                title,
                description: [
                    ratingHtml,
                    image ? `<p><img src="${image}" /></p>` : `最上一花作品：${title}`
                ].join("\n"),
                content,
                author: [{ name: "最上一花" }]
            };

            if (date) item.date = date;
    
            feed.addItem(item);
        });
    }

    // Put the normalized image filename code at the beginning of description,
    // immediately before the cover image.
    let rss = feed.rss2()
        .replace(/<guid\b[^>]*>[\s\S]*?<\/guid>/g, "")
        .replace(
            /(<item>\s*<title>[\s\S]*?<\/title>\s*)(<link>[\s\S]*?<\/link>)([\s\S]*?)(<description>[\s\S]*?<\/description>)/g,
            "$1$4\n$2$3"
        );

    rss = rss.replace(/<item>([\s\S]*?)<\/item>/g, (itemXml) => {
        const imageMatch = itemXml.match(/<img\b[^>]*src=["']([^"']+)["']/i);
        if (!imageMatch) return itemXml;

        let filename = "";
        try {
            filename = decodeURIComponent(
                new URL(imageMatch[1]).pathname.split("/").pop() || ""
            );
        } catch {
            return itemXml;
        }

        const number = filename
            .replace(/\.[^.]+$/, "")
            .replace(/^pf_o1_/i, "")
            .replace(/ps$/i, "")
            .replace(/([a-z]+)(\d+)/i, "$1-$2");

        if (!number) return itemXml;

        let updatedItem = itemXml.replace(
            /(<description>\s*<!\[CDATA\[)/,
            `$1<number>${number}</number>\n`
        );

        // Also place the same number before the actor paragraph in content:encoded.
        updatedItem = updatedItem.replace(
            /(<content:encoded>\s*<!\[CDATA\[\s*<div>\s*)<p>演员：/,
            `$1<number>${number}</number>\n<p>演员：`
        );

        return updatedItem;
    });

    return rss;
}
