import os
import re
import json
import requests
from dotenv import load_dotenv

# Load env variables for Gemini API key
load_dotenv()

def get_gemini_api_key():
    return os.environ.get("GEMINI_API_KEY", "")

def call_gemini(prompt, api_key):
    """
    Calls the Gemini API using requests to generate content.
    Uses gemini-2.5-flash for speed and reliability.
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ]
    }
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=15)
        if response.status_code == 200:
            result = response.json()
            # Extract text from response
            # Best-effort extraction of text for various response shapes
            try:
                text = result['candidates'][0]['content']['parts'][0]['text']
            except Exception:
                # Try alternative keys
                text = None
                if isinstance(result, dict):
                    # Flatten any nested string fields
                    for v in result.values():
                        if isinstance(v, str):
                            text = v
                            break
            if text is None:
                # Unknown response shape
                return None
            return text.strip()
        else:
            print(f"Gemini API Error: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"Gemini API Exception: {e}")
        return None

def heuristic_nl_to_sql(user_query, table_name, columns, schema_dict):
    """
    Fallback rule-based engine to translate NL to SQL.
    Supports basic SELECT, AVG, SUM, COUNT, MIN, MAX, GROUP BY, ORDER BY, LIMIT, and WHERE filter patterns.
    """
    query = user_query.lower().strip()
    
    # 1. Detect limit
    limit_val = None
    limit_match = re.search(r'\b(top|first|limit|bottom)\b\s*(\d+)', query)
    if limit_match:
        limit_val = int(limit_match.group(2))
    elif re.search(r'\b(sample|few)\b', query):
        limit_val = 5

    # 2. Detect order direction (desc vs asc)
    sort_dir = "ASC"
    if any(word in query for word in ["highest", "largest", "maximum", "max", "top", "descending", "desc", "most", "best", "biggest"]):
        sort_dir = "DESC"
    elif any(word in query for word in ["lowest", "smallest", "minimum", "min", "bottom", "ascending", "asc", "least"]):
        sort_dir = "ASC"

    # 3. Match column names in the query
    matched_cols = []
    for col in columns:
        # Avoid partial matches that are too short, match as words
        if re.search(r'\b' + re.escape(col) + r'\b', query):
            matched_cols.append(col)

    # 4. Group by detection
    group_col = None
    group_match = re.search(r'\b(by|each|per|group\s+by)\s+([a-z0-9_]+)\b', query)
    if group_match:
        potential_group = group_match.group(2)
        if potential_group in columns:
            group_col = potential_group
        else:
            # Try searching matched columns that might be categorical
            for col in matched_cols:
                if col in query.split("by")[-1] or col in query.split("each")[-1]:
                    group_col = col
                    break

    # 5. Aggregate function detection
    agg_func = None
    target_col = None
    
    # Check if we are doing a count
    if any(word in query for word in ["count", "number of", "how many", "total records", "total rows"]):
        agg_func = "COUNT"
    
    # Match operations with specific columns
    for col in matched_cols:
        col_idx = query.find(col)
        # Check surrounding text for aggregations
        surrounding = query[max(0, col_idx-15):col_idx]
        if any(w in surrounding for w in ["average", "avg", "mean"]):
            agg_func = "AVG"
            target_col = col
            break
        elif any(w in surrounding for w in ["sum", "total"]):
            agg_func = "SUM"
            target_col = col
            break
        elif any(w in surrounding for w in ["maximum", "max", "highest", "largest", "biggest"]):
            agg_func = "MAX"
            target_col = col
            break
        elif any(w in surrounding for w in ["minimum", "min", "lowest", "smallest"]):
            agg_func = "MIN"
            target_col = col
            break

    # If no specific target, look at numeric columns
    numeric_cols = [c for c, t in schema_dict.items() if "int" in t.lower() or "float" in t.lower() or "double" in t.lower() or "real" in t.lower() or "numeric" in t.lower()]
    
    if agg_func and agg_func != "COUNT" and not target_col:
        # Default to first matched numeric column or first numeric column overall
        matched_numeric = [c for c in matched_cols if c in numeric_cols]
        if matched_numeric:
            target_col = matched_numeric[0]
        elif numeric_cols:
            target_col = numeric_cols[0]
        else:
            # Fallback to count if no numeric columns found
            agg_func = "COUNT"

    # 6. Filters (WHERE clause)
    where_clause = ""
    # Try to find standard comparison patterns e.g., col > val, col is val
    for col in columns:
        col_type = schema_dict.get(col, "")
        is_numeric = "int" in col_type.lower() or "float" in col_type.lower() or "double" in col_type.lower() or "real" in col_type.lower()
        
        # Look for col is "val" or col equals "val"
        is_match = re.search(rf'\b{col}\b\s*(?:is|equals|=)\s*([\'"]?)([a-zA-Z0-9_\s.-]+)\1', query)
        if is_match:
            val = is_match.group(2).strip()
            if is_numeric:
                where_clause = f" WHERE {col} = {val}"
            else:
                where_clause = f" WHERE {col} LIKE '%{val}%'"
            break
            
        # Greater than
        gt_match = re.search(rf'\b{col}\b\s*(?:greater than|more than|>)\s*(\d+(\.\d+)?)', query)
        if gt_match:
            where_clause = f" WHERE {col} > {gt_match.group(1)}"
            break
            
        # Less than
        lt_match = re.search(rf'\b{col}\b\s*(?:less than|under|<)\s*(\d+(\.\d+)?)', query)
        if lt_match:
            where_clause = f" WHERE {col} < {lt_match.group(1)}"
            break

    # 7. Construct SQL Query
    sql = ""
    if agg_func:
        if agg_func == "COUNT":
            if group_col:
                sql = f"SELECT {group_col}, COUNT(*) AS count_records FROM {table_name}"
            else:
                sql = f"SELECT COUNT(*) AS total_records FROM {table_name}"
        else:
            # SUM, AVG, MAX, MIN
            if group_col:
                sql = f"SELECT {group_col}, {agg_func}({target_col}) AS {agg_func.lower()}_{target_col} FROM {table_name}"
            else:
                sql = f"SELECT {agg_func}({target_col}) AS {agg_func.lower()}_{target_col} FROM {table_name}"
    else:
        # No aggregate
        if matched_cols:
            # Keep unique matched columns, put grouped column first if present
            select_cols = []
            if group_col:
                select_cols.append(group_col)
            for c in matched_cols:
                if c not in select_cols:
                    select_cols.append(c)
            
            # If we only have 1 or 2 columns, it might be too sparse, check if we should just SELECT *
            if len(select_cols) < 2 and not limit_val:
                select_cols = ["*"]
                
            sql = f"SELECT {', '.join(select_cols)} FROM {table_name}"
        else:
            sql = f"SELECT * FROM {table_name}"

    # Add WHERE
    if where_clause:
        sql += where_clause

    # Add GROUP BY
    if group_col and agg_func:
        sql += f" GROUP BY {group_col}"

    # Add ORDER BY
    if group_col and agg_func:
        # Sort by the aggregate column
        agg_alias = f"{agg_func.lower()}_{target_col}" if agg_func != "COUNT" else "count_records"
        sql += f" ORDER BY {agg_alias} {sort_dir}"
    elif matched_cols and len(matched_cols) > 0 and not select_cols == ["*"]:
        # Sort by the first matched numeric column or first matched column
        sort_col = matched_cols[0]
        # Prefer numeric for sorting
        numeric_matched = [c for c in matched_cols if c in numeric_cols]
        if numeric_matched:
            sort_col = numeric_matched[0]
        sql += f" ORDER BY {sort_col} {sort_dir}"
    elif numeric_cols:
        # Default sort by first numeric column
        sql += f" ORDER BY {numeric_cols[0]} {sort_dir}"

    # Add LIMIT
    if limit_val:
        sql += f" LIMIT {limit_val}"
    elif "SELECT *" in sql or not agg_func:
        sql += " LIMIT 50" # Default safety limit

    return sql

class NLPEngine:
    def __init__(self):
        self.api_key = get_gemini_api_key()
        self.has_api = len(self.api_key.strip()) > 0
        # Whether the last Gemini API call succeeded (valid key + reachable)
        self.last_api_ok = False

    def set_api_key(self, key: str):
        """Set the Gemini API key for this engine instance at runtime."""
        self.api_key = (key or "").strip()
        # Update environment var for child processes or future instantiations
        if self.api_key:
            os.environ["GEMINI_API_KEY"] = self.api_key
        else:
            os.environ.pop("GEMINI_API_KEY", None)
        self.has_api = len(self.api_key) > 0

    def _call_gemini(self, prompt: str):
        """Wrapper to call Gemini and update last_api_ok flag."""
        if not self.has_api:
            self.last_api_ok = False
            return None
        try:
            text = call_gemini(prompt, self.api_key)
            self.last_api_ok = bool(text)
            return text
        except Exception as e:
            print(f"Gemini call exception: {e}")
            self.last_api_ok = False
            return None

    def generate_sql(self, user_query, table_name, schema_dict):
        """
        Translates a natural language query into SQL SELECT statement.
        """
        columns = list(schema_dict.keys())
        
        # Prepare schema details for the prompt or parser
        schema_desc = f"Table: {table_name}\nColumns:\n"
        for col, dtype in schema_dict.items():
            schema_desc += f"  - {col} ({dtype})\n"

        if self.has_api:
            prompt = f"""You are an expert SQL Generator. Translate the user's natural language request into a single SQLite query.

Table Schema:
{schema_desc}

User Request: "{user_query}"

Rules:
1. ONLY return the plain-text executable SQL query. Do not wrap it in markdown block formatting like ```sql.
2. Use only table and columns defined in the schema.
3. Make sure table and column names match the schema exactly (lowercase, snake_case).
4. Perform case-insensitive string filtering using LIKE if appropriate.
5. Add a safety LIMIT of 100 unless a specific limit is requested.
6. Ensure standard SQL syntaxes compatible with SQLite.

SQL Query:"""
            ai_sql = self._call_gemini(prompt)
            if ai_sql:
                # Clean up any potential AI markdown noise
                ai_sql = ai_sql.replace("```sql", "").replace("```", "").strip()
                # Make sure it's a SELECT statement for safety
                if ai_sql.lower().startswith("select"):
                    return ai_sql

        # Fall back to heuristic rule-based SQL generation
        return heuristic_nl_to_sql(user_query, table_name, columns, schema_dict)

    def generate_insights(self, sql_query, data_rows):
        """
        Generates automated strategic business insights based on query outcomes.
        """
        if not data_rows:
            return ["No data available to analyze.", "Try broadening your query filters."]

        # Check if we have Gemini API
        if self.has_api:
            data_json = json.dumps(data_rows[:20], indent=2) # Send up to 20 rows of results for context
            prompt = f"""You are a Strategic Business Intelligence Analyst.
Analyze the following SQL query and the resulting data output. Provide 3 to 4 bullet points summarizing key insights, trends, or recommendations.

SQL Query Run:
{sql_query}

Query Result (JSON format):
{data_json}

Format Guidelines:
- Highlight performance, high/low anomalies, or growth patterns.
- Make insights actionable and strategic for business decision-makers.
- Keep the language clean and concise.
- Provide ONLY the bullet points, no extra greeting or conversational filler.
"""
            ai_insights = self._call_gemini(prompt)
            if ai_insights:
                bullets = [line.strip().lstrip('-*• ').strip() for line in ai_insights.split('\n') if line.strip()]
                return [b for b in bullets if b]

        # Built-in heuristic insights
        insights = []
        
        # Look at the data records to generate a basic report
        num_records = len(data_rows)
        keys = list(data_rows[0].keys()) if num_records > 0 else []
        
        insights.append(f"Successfully retrieved {num_records} record(s) matching your request.")
        
        # Try to extract key details based on data types
        if num_records > 0:
            # Let's check if there's an aggregate value or if we have columns
            first_row = data_rows[0]
            
            # Scenario A: Result is single value (e.g. COUNT or SUM)
            if len(keys) == 1:
                val_name = keys[0]
                val = first_row[val_name]
                insights.append(f"The calculated value for **{val_name.replace('_', ' ')}** is **{val}**.")
            
            # Scenario B: Multiple rows, check for numeric and category columns
            elif len(keys) >= 2:
                # Identify numeric and string keys
                numeric_keys = []
                cat_keys = []
                for k, v in first_row.items():
                    if isinstance(v, (int, float)):
                        numeric_keys.append(k)
                    else:
                        cat_keys.append(k)
                
                # Check for sorting trends if there are numeric values
                if numeric_keys and cat_keys:
                    cat_col = cat_keys[0]
                    num_col = numeric_keys[0]
                    
                    # Sort data to find max and min in result set
                    try:
                        sorted_data = sorted(data_rows, key=lambda x: x[num_col] if x[num_col] is not None else 0, reverse=True)
                        max_row = sorted_data[0]
                        min_row = sorted_data[-1]
                        
                        insights.append(f"**Highest performer**: **{max_row[cat_col]}** recorded the maximum value of **{max_row[num_col]}** for {num_col.replace('_', ' ')}.")
                        if num_records > 1:
                            insights.append(f"**Lowest performer**: **{min_row[cat_col]}** recorded the minimum value of **{min_row[num_col]}**.")
                        
                        # Calculate average if there are several records
                        if num_records > 2:
                            vals = [x[num_col] for x in data_rows if x[num_col] is not None]
                            avg_val = sum(vals) / len(vals) if vals else 0
                            insights.append(f"The average **{num_col.replace('_', ' ')}** across all listed records is **{round(avg_val, 2)}**.")
                    except Exception:
                        pass
        
        insights.append("To get advanced Strategic AI insights, configure your `GEMINI_API_KEY` in the workspace environment settings.")
        return insights
