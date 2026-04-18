# Quick Data — social media performance dashboard

A static, browser-only dashboard that takes a social media data export (CSV or multi-sheet XLSX) and produces a report:

- KPIs: posts, total impressions, total engagement, viral count, averages
- Topic clusters discovered from post text (when available)
- Patterns behind viral posts (length, hooks, hashtags, lists, day-of-week)
- Top 10 posts by engagement (or impressions)
- People leaderboard (when there's an author / individual column)
- Daily timeline for aggregate sheets

Everything runs locally in your browser — your file is never uploaded anywhere.

## How to use

1. Open the live site **or** open `index.html` directly in a browser.
2. Click **Load sample data** to see how it works, or drag in your own CSV / XLSX export.
3. If your file has multiple sheets (e.g. an XLSX SharePoint archive), use the sheet picker at the top to switch between them. The dashboard adapts to the shape of each sheet.

## Supported inputs

- **CSV** — any flat post-level export
- **XLSX** — any Excel workbook, including multi-sheet exports. Each sheet is detected as **post-level**, **daily aggregate**, or **empty**, and the dashboard renders the appropriate view.

## Recognised columns

Column names are matched flexibly. The matcher prefers exact column names but falls back to whole-word matches.

| Field | Recognised column names |
|---|---|
| Post text | `Post commentary`, `Post title`, `Post text`, `Description`, `Content`, `Message`, `Title` |
| Date | `Post publish date`, `Created date`, `Publish time`, `Posted at`, `Published`, `Date` |
| Likes | `Likes`, `Reactions`, `Reactions (total)`, `Reactions (organic)`, `LinkedIn reactions` |
| Comments | `Comments`, `Comments (total)`, `Comments (organic)`, `LinkedIn comments` |
| Reposts | `Reposts`, `Reposts (total)`, `Reposts (organic)`, `Shares`, `LinkedIn reposts` |
| Impressions | `Impressions`, `Impressions (total)`, `Impressions (organic)`, `Views`, `Reach` |
| Engagements | `Engagements`, `Engagement`, `All engagements` |
| URL | `Post link`, `Post URL`, `Permalink`, `Link` |
| Author | `Individual`, `Posted by`, `Account name`, `Page name` |
| Type | `Content type`, `Post type`, `Type` |

Only the post text column is needed for topic clustering — everything else is optional.

## Where the analysis comes from

- **Engagement score** = `likes + 2×comments + 3×reposts`. Comments and reposts are weighted higher because they signal stronger reach on LinkedIn's algorithm.
- **Viral threshold** = top 20% of posts by engagement.
- **Topic clusters** = TF-IDF over post text. Each post is assigned to the topic term with its highest score.
- **"Why they worked"** compares averages across viral vs. the rest: length, hashtag count, opening-line patterns, presence of questions / numbers / lists / emoji, and best day of week.

## Stack

- Plain HTML/CSS/JS — no build step
- [PapaParse](https://www.papaparse.com/) for CSV parsing
- [SheetJS](https://sheetjs.com/) for XLSX parsing
- [Chart.js](https://www.chartjs.org/) for charts
- LinkedIn-inspired styling (Source Sans 3, brand blue `#0A66C2`, surface `#F4F2EE`)
