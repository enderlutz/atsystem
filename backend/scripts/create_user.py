"""Create a dashboard user.

Usage (run from backend/ directory):
  python scripts/create_user.py --username alan --password "secret" --role admin --name "Alan"
  python scripts/create_user.py --username thomas --password "secret" --role admin --name "Thomas"
  python scripts/create_user.py --username va --password "secret" --role va --name "VA"
"""
import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bcrypt
from db import get_db

parser = argparse.ArgumentParser(description="Create a dashboard user")
parser.add_argument("--username", required=True, help="Login username")
parser.add_argument("--password", required=True, help="Login password")
parser.add_argument("--role", required=True, choices=["admin", "va"], help="User role")
parser.add_argument("--name", required=True, help="Display name")
args = parser.parse_args()

db = get_db()

# Check for existing user
existing = db.table("users").select("username").eq("username", args.username).execute()
if existing.data:
    print(f"Error: user '{args.username}' already exists")
    sys.exit(1)

pw_hash = bcrypt.hashpw(args.password.encode(), bcrypt.gensalt()).decode()
db.table("users").insert({
    "username": args.username,
    "display_name": args.name,
    "password_hash": pw_hash,
    "role": args.role,
}).execute()
print(f"Created user: {args.username} ({args.role}) — display name: {args.name}")
