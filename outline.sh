#!/bin/bash

INPUT="$1"
TMP_BMP="tmp.bmp"
TMP_SVG="tmp.svg"
OUTPUT="outlined.svg"

# 1. PNG -> bitmap alb/negru
convert "$INPUT" -alpha remove -threshold 60% "$TMP_BMP"

# 2. bitmap -> vector
potrace "$TMP_BMP" -s -o "$TMP_SVG"

# 3. adauga outline (stroke)
sed 's/fill="black"/fill="none" stroke="black" stroke-width="4"/g' "$TMP_SVG" > "$OUTPUT"

rm "$TMP_BMP" "$TMP_SVG"

echo "Done -> $OUTPUT"