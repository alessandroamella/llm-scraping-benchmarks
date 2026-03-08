#!/bin/bash

file1=$(cat /home/bitrey/Documents/webdev_projects/ce-sciopero/apps/backend/package.json)
file2=$(listcontents -md -nc data/ data.tmp/ results/ -e data/Trenord/ai_strikes data/Trenitalia/ai_strikes)

# print both

echo "# Backend package.json:"
echo ""
echo '```'
echo "$file1"
echo '```'

echo ""
echo "# Files inside src/benchmarks:"
echo ""
echo "$file2"

