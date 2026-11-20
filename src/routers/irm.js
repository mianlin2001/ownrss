
import * as cheerio from "cheerio";
import { Feed } from "feed";

const SOURCE = "https://irm.avlabo.com";
const DEFAULT_ACTOR = "nizimura_yumi";

function cleanText(value = "") {
    return String(value)
        .replace(/\s+/g, " ")
        .trim();
}

function absoluteUrl(value) {
    if (!value) return "";
    try {
        return new URL(value, SOURCE).href;
    } catch {
        return "";
    }
}

function parseDate(value) {
    const match = cleanText(value).match(
        /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/
    );

    if (!match) return null;

    const [, year, month, day] = match;

    return new Date(Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day)
    ));
}

function getImage($card) {
    const img = $card.find(".thumb_link_img img").first();

    const src =
        img.attr("data-src") ||
        img.attr("data-original") ||
        img.attr("src");

    return absoluteUrl(src);
}

// 商品番号と記事IDは別物。記事ID形式（例: 16_073116）は番号として扱わない。
function extractProductNumber(value = "") {
    const text = cleanText(value);
    const match = text.match(/\b[A-Z]{2,6}-\d{2,5}\b/i);
    return match ? match[0].toUpperCase() : "";
}

async function getProductNumberFromDetail(url) {
    if (!url) return "";

    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; WorkerRSS/1.0)",
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "ja,en-US;q=0.9"
            }
        });

        if (!response.ok) return "";

        const html = await response.text();
        const $detail = cheerio.load(html);

        // 先看常见的番号/商品コード字段，再扫描详情正文。
        const labeled = $detail(
            '[class*="code"], [class*="number"], [class*="jan"], [id*="code"], [id*="number"]'
        ).map((_, el) => $detail(el).text()).get().join(" ");

        return extractProductNumber(labeled) ||
            extractProductNumber($detail("body").text());
    } catch {
        return "";
    }
}

function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

export async function irm(input, baseUrl) {
    const actor = cleanText(input || DEFAULT_ACTOR);

    if (!/^[a-zA-Z0-9_-]+$/.test(actor)) {
        throw new Error("无效的演员档案名称");
    }

    const sourceUrl =
        `${SOURCE}/archives/${actor}.php`;

    const currentRssUrl =
        `${baseUrl}?irm=${encodeURIComponent(actor)}`;

    const response = await fetch(sourceUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; WorkerRSS/1.0)",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "ja,en-US;q=0.9"
        }
    });

    if (!response.ok) {
        throw new Error(
            `目标网页请求失败: HTTP ${response.status}`
        );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const feed = new Feed({
        title: `虹村ゆみ - 作品更新`,
        description: `虹村ゆみ作品列表更新`,
        id: sourceUrl,
        link: sourceUrl,
        feedLinks: {
            rss: currentRssUrl
        },
        language: "ja",
        updated: new Date()
    });

    let cards = $("#sort-app article");

    if (!cards.length) {
        cards = $(".entries.thumb_list article");
    }

    // 兼容没有 article 包装的页面
    if (!cards.length) {
        cards = $(".entries.thumb_list .thumb_link");
    }

    let count = 0;

    cards.each((index, element) => {
        const root = $(element);

        const card = root.hasClass("thumb_link")
            ? root
            : root.find(".thumb_link").first();

        if (!card.length) return;

        const title = cleanText(
            card.find(".thumb_link_ttl").first().text() ||
            card.find("a[title]").first().attr("title")
        );

        const anchor = card.children("a").first();

        const link = absoluteUrl(
            anchor.attr("href") ||
            card.find("a[href]").first().attr("href")
        );

        const image = getImage(card);

        const actorName = cleanText(
            card.find(".thumb_link_person a").text()
        ) || "虹村ゆみ";

        const dateText = cleanText(
            card.find(".thumb_link_date").text()
        );

        const pubDate = parseDate(dateText);

        // 卡片上有标准番号时直接使用；下划线形式通常是站内文章ID，
        // 需要进入详情页查真正的商品番号。
        const articleId = card.attr("id") || link;
        let productNumber = extractProductNumber(card.text());

        if (!productNumber) {
            productNumber = await getProductNumberFromDetail(link);
        }

        if (!title || !link) return;

        const content = `
            <div>
                <p>作品番号：${escapeHtml(productNumber || "未识别")}</p>
                ${image
                    ? `<p><img src="${escapeHtml(image)}"
                         alt="${escapeHtml(title)}"
                         style="max-width:100%"></p>`
                    : ""}
                <p>演员：${escapeHtml(actorName)}</p>
                <p>发行日期：${escapeHtml(dateText || "未知")}</p>
                <p>网站文章 ID：${escapeHtml(articleId)}</p>
                <p><a href="${escapeHtml(link)}">查看作品详情</a></p>
            </div>
        `;

        feed.addItem({
            id: link,
            title: productNumber ? `[${productNumber}] ${title}` : title,
            link,
            date: pubDate || new Date(),
            author: [
                { name: actorName }
            ],
            content
        });

        count++;
    });

    if (!count) {
        throw new Error(
            "没有找到作品，请检查网页 HTML 结构或 CSS 选择器"
        );
    }

    return feed.rss2();
}
