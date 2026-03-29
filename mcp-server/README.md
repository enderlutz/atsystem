# AT System MCP Server

Gives Claude Code read-only access to the AT System database for analytics, insights, and decision support.

## Setup (5 minutes)

### 1. Install dependencies

```bash
cd mcp-server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure database connection

```bash
cp .env.example .env
```

Edit `.env` and add your PostgreSQL connection string:

```
DATABASE_URL=postgresql://user:password@host:port/database
```

This is the same `DATABASE_URL` from `backend/.env`.

### 3. Add to Claude Code settings

Open your Claude Code settings file:

```bash
# Mac/Linux
nano ~/.claude/settings.json
```

Add the MCP server config (update the path to match your local clone):

```json
{
  "mcpServers": {
    "at-analytics": {
      "command": "/path/to/at-system/mcp-server/.venv/bin/python",
      "args": ["/path/to/at-system/mcp-server/server.py"],
      "cwd": "/path/to/at-system/mcp-server"
    }
  }
}
```

**Example for Mac:**
```json
{
  "mcpServers": {
    "at-analytics": {
      "command": "/Users/yourname/Documents/GitHub/at-system/mcp-server/.venv/bin/python",
      "args": ["/Users/yourname/Documents/GitHub/at-system/mcp-server/server.py"],
      "cwd": "/Users/yourname/Documents/GitHub/at-system/mcp-server"
    }
  }
}
```

### 4. Restart Claude Code

Close and reopen Claude Code (or run `/mcp` to check server status).

## Available Tools

Once connected, Claude can use these tools in conversation:

| Tool | What it does |
|------|-------------|
| `get_business_summary` | High-level KPIs: leads, bookings, revenue, conversion |
| `get_revenue_metrics` | Revenue details: monthly, trend, tier breakdown, top zips |
| `get_conversion_funnel` | Full funnel: leads → estimated → sent → viewed → booked |
| `get_pipeline_snapshot` | Current pipeline state by workflow stage |
| `get_speed_metrics` | Time to estimate, time to booking, bottlenecks |
| `get_zip_code_performance` | Performance by zip code area |
| `get_tier_analysis` | Essential vs Signature vs Legacy patterns |
| `get_sms_effectiveness` | SMS automation delivery and response rates |
| `get_proposal_engagement` | How customers interact with proposals |
| `get_cohort_analysis` | Weekly/monthly cohort conversion tracking |
| `query_leads` | Search leads by status, stage, zip, etc. |
| `get_lead_detail` | Full detail for a specific lead |
| `get_automation_activity` | Recent automation log events |
| `get_day_of_week_patterns` | When leads arrive, when bookings happen |
| `run_readonly_query` | Custom SQL (SELECT only) for ad-hoc analysis |

## Example Questions

Once set up, just ask Claude:

- "How are we doing this month?"
- "Which zip codes have the best conversion rate?"
- "Where are we losing customers in the funnel?"
- "What's our average time from lead to booking?"
- "Show me leads that went cold after proposal"
- "Which SMS sequences get the best response rates?"
- "Compare this month's cohort to last month"

## Security

- **Read-only**: All database connections are set to `readonly=True`. No writes possible.
- **Local only**: The server runs on your machine, data never leaves your computer.
- **No secrets in repo**: Database URL is in `.env` (gitignored).
