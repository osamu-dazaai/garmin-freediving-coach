#!/usr/bin/env python3
import sqlite3
from pathlib import Path

DB_PATH = Path('data/freediving.db')
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Get all tables
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = cursor.fetchall()

print("📊 Database Schema\n" + "="*60)
for table in tables:
    table_name = table[0]
    print(f"\n🗂️  Table: {table_name}")
    print("-" * 60)
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = cursor.fetchall()
    for col in columns:
        print(f"  {col[1]:<20} {col[2]:<15}")
    
    # Show sample row
    cursor.execute(f"SELECT * FROM {table_name} LIMIT 1")
    sample = cursor.fetchone()
    if sample:
        print(f"\n  Sample data: {sample[0]}")

conn.close()
