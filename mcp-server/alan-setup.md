# MCP Server Setup — Alan

This gives Claude Code read-only access to the AT System database so you can ask business questions in natural language.

---

## Step 1: Install Python (if not already installed)

Open Terminal and check:

```bash
python3 --version
```

If it shows `Python 3.9` or higher, skip to Step 2.

If not installed, run:

```bash
brew install python
```

If you don't have Homebrew either, install it first:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

---

## Step 2: Clone the repo

```bash
cd ~/Documents
git clone https://github.com/enderlutz/atsystem.git
cd atsystem/mcp-server
```

---

## Step 3: Set up the MCP server

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## Step 4: Add the database connection

```bash
cp .env.example .env
```

Open the `.env` file and paste the Supabase connection string that was shared with you (ask the team lead if you don't have it):

```bash
nano .env
```

It should look like:

```
DATABASE_URL=postgresql://postgres.xxxxx:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

Save and exit (`Ctrl + X`, then `Y`, then `Enter`).

---

## Step 5: Test the connection

```bash
.venv/bin/python -c "from server import _query_one; print(_query_one('SELECT COUNT(*) AS cnt FROM leads'))"
```

You should see something like `{'cnt': 29}`. If you get an error, double-check the DATABASE_URL in `.env`.

---

## Step 6: Connect to Claude Code

Open your Claude Code settings file:

```bash
nano ~/.claude/settings.json
```

If the file is empty or has `{}`, replace the contents with:

```json
{
  "mcpServers": {
    "at-analytics": {
      "command": "/Users/alan/Documents/atsystem/mcp-server/.venv/bin/python",
      "args": ["/Users/alan/Documents/atsystem/mcp-server/server.py"],
      "cwd": "/Users/alan/Documents/atsystem/mcp-server"
    }
  }
}
```

**Important:** Replace `/Users/alan` with your actual home directory. To find it, run `echo $HOME` in Terminal.

If the file already has content, just add the `"mcpServers"` block inside the existing `{}`.

Save and exit (`Ctrl + X`, then `Y`, then `Enter`).

---

## Step 7: Restart Claude Code

Close and reopen your Terminal, then start Claude Code:

```bash
claude
```

---

## Step 8: Verify it works

Once Claude Code is running, type:

```
How is the business doing this month?
```

Claude should pull live data from the database and give you a summary. If it works, you're all set.

---

## What you can ask

Once set up, just ask Claude questions like:

- "How are we doing this month?"
- "What's our conversion rate?"
- "Which zip codes bring the most revenue?"
- "Where are we losing customers in the funnel?"
- "How fast are we getting estimates out?"
- "Which follow-up messages get the best response?"
- "Show me leads that are stuck in the pipeline"
- "Compare this week's leads to last week"

Claude will pull real-time data from the database to answer.

---

## Note for team lead

The `.env` file is gitignored — it won't be in the repo. You need to send Alan the Supabase DATABASE_URL separately (text, email, or in person). Do NOT commit it to the repo.

---

## Troubleshooting

**"MCP server not connecting"**
- Make sure the paths in `settings.json` are correct (use `echo $HOME` to check)
- Make sure you ran `pip install -r requirements.txt` inside the `.venv`

**"Connection refused" or database errors**
- Check that the DATABASE_URL in `.env` is correct
- Make sure you can reach Supabase from your network (no VPN blocking it)

**"Claude doesn't seem to use the data tools"**
- Run `/mcp` inside Claude Code to check the server status
- If it shows disconnected, restart Claude Code
