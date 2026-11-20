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

    const response = await fetch(SOURCE_URL, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml"
        }
    });

    if (!response.ok) {
        throw new Error(`IRMLabo HTTP Error: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

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

    $("article").each((_, element) => {
        const article = $(element);

        const actorLinks = article
            .find(".thumb_link_person a")
            .map((_, anchor) => $(anchor).attr("href"))
            .get();

        const isTargetActor = actorLinks.some((href) => {
            if (!href) return false;

            try {
                return new URL(href, SOURCE_URL).pathname === ACTOR_PATH;
            } catch {
                return false;
            }
        });

        if (!isTargetActor) return;

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

        if (!title || !link || seen.has(link)) return;
        seen.add(link);

        const content = `
            <div>
                <p>演员：最上一花</p>
                <p>作品：${title}</p>
                <p>发行日期：${dateText || "未知"}</p>
                ${image ? `<p><img src="${image}" alt="${title}" /></p>` : ""}
                <p><a href="${link}">查看作品详情</a></p>
            </div>
        `;

        const item = {
            id: link,
            link,
            title,
            description: image
                ? `<p><img src="${image}" /></p>`
                : `最上一花作品：${title}`,
            content,
            author: [{ name: "最上一花" }]
        };

        if (date) item.date = date;

        feed.addItem(item);
    });

    // Move each item's description (cover image) before its link in the RSS XML.
    return feed.rss2().replace(
        /(<item>\s*<title>[\s\S]*?<\/title>\s*)(<link>[\s\S]*?<\/link>)([\s\S]*?)(<description>[\s\S]*?<\/description>)/g,
        "$1$4\n$2$3"
    );
}
