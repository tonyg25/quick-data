# Quick Data — LinkedIn viral post dashboard

A static, browser-only dashboard that takes a CSV of your LinkedIn posts and tells you:

- Which posts went viral (top 20% by engagement)
- What topics they cluster into
- Which patterns the viral posts share (length, hooks, hashtags, lists, day-of-week)
- The top 10 highest-engagement posts

Everything runs locally in your browser — your CSV is never uploaded anywhere.

## How to use

1. Open the live site (GitHub Pages link in repo settings) **or** open `index.html` directly in a browser.
2. Click **Load sample data** to see how it works, or drag your own CSV onto the upload zone.
3. Scroll through the dashboard.

## CSV format

Column names are auto-detected. Any of these work:

| Field | Recognised column names |
|---|---|
| Post text | `Post commentary`, `Post text`, `text`, `content`, `message` |
| Date | `Date`, `Post date`, `Created`, `Posted at`, `Published` |
| Likes | `Likes`, `Reactions`, `Total reactions` |
| Comments | `Comments`, `Comment count` |
| Reposts | `Reposts`, `Shares` |
| Impressions | `Impressions`, `Views`, `Reach` |
| URL | `URL`, `Post URL`, `Link` |
| Type | `Type`, `Post type` |

Only the post text column is required. Everything else is optional but unlocks more analysis.

## Where the analysis comes from

- **Engagement score** = `likes + 2×comments + 3×reposts`. Comments and reposts are weighted higher because they signal stronger reach on LinkedIn's algorithm.
- **Viral threshold** = top 20% of posts by engagement.
- **Topic clusters** = TF-IDF over post text. Each post is assigned to the topic term with its highest score.
- **"Why they worked"** compares averages across viral vs. the rest: length, hashtag count, opening-line patterns, presence of questions / numbers / lists / emoji, and best day of week.

## Stack

- Plain HTML/CSS/JS — no build step
- [PapaParse](https://www.papaparse.com/) for CSV parsing
- [Chart.js](https://www.chartjs.org/) for charts
- LinkedIn-inspired styling (Source Sans 3, brand blue `#0A66C2`, surface `#F4F2EE`)
