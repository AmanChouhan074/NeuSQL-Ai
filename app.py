import os
import re
import sqlite3
import json
import datetime
from flask import Flask, request, jsonify, render_template, send_from_directory
from werkzeug.utils import secure_filename
from utils.cleaner import DataCleaner
from utils.nlp_engine import NLPEngine

app = Flask(__name__)

# Config
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
DB_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'database')
DB_PATH = os.path.join(DB_FOLDER, 'workspace.db')
HISTORY_PATH = os.path.join(DB_FOLDER, 'history.json')
ALLOWED_EXTENSIONS = {'csv', 'xlsx', 'xls'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024  # 20MB Max

# Ensure directories exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(DB_FOLDER, exist_ok=True)

# Initialize NLP Engine
nlp_engine = NLPEngine()

# Helper to read/write history logs
def get_history():
    if not os.path.exists(HISTORY_PATH):
        return []
    try:
        with open(HISTORY_PATH, 'r') as f:
            return json.load(f)
    except Exception:
        return []

def add_history_entry(action_type, details):
    history = get_history()
    entry = {
        "timestamp": datetime.datetime.now().isoformat(),
        "action": action_type,
        "details": details
    }
    history.insert(0, entry)  # Add to top
    # Limit history to 50 items
    history = history[:50]
    try:
        with open(HISTORY_PATH, 'w') as f:
            json.dump(history, f, indent=4)
    except Exception as e:
        print(f"Error saving history: {e}")

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# Internal sample tables to hide from the UI
# Keep the demo dataset visible so it can be used as an active query source.
def is_internal_table(table_name):
    return table_name in ('orders_test', 'test_orders')

# Internal history entries to hide from the UI
def is_internal_history_entry(entry):
    details = entry.get('details', {}) if isinstance(entry, dict) else {}
    table = details.get('table_name', '')
    sql_query = details.get('sql_query', '')
    # Only hide explicit internal sample tables, not the demo dataset.
    if table in ('orders_test', 'test_orders'):
        return True
    if isinstance(sql_query, str) and any(term in sql_query for term in ('orders_test', 'test_orders')):
        return True
    return False

# Custom JSON encoder to handle dates
class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime.date, datetime.datetime)):
            return obj.isoformat()
        return super(CustomJSONEncoder, self).default(obj)

app.json_encoder = CustomJSONEncoder

@app.route('/status', methods=['GET'])
def get_status():
    return jsonify({
        "gemini_active": nlp_engine.has_api,
        "gemini_valid": getattr(nlp_engine, 'last_api_ok', False),
        "database_exists": os.path.exists(DB_PATH)
    })


@app.route('/session', methods=['POST'])
def set_session():
    """Set runtime session values such as a Gemini API key.
    Expects JSON: { "gemini_key": "<key>" }
    """
    data = request.json or {}
    gemini_key = data.get('gemini_key', '')

    try:
        # Update engine API key at runtime
        nlp_engine.set_api_key(gemini_key)
        add_history_entry("Session", {"gemini_key_set": bool(gemini_key)})
        return jsonify({"message": "Session updated.", "gemini_active": nlp_engine.has_api})
    except Exception as e:
        return jsonify({"error": f"Failed to set session: {str(e)}"}), 500


@app.route('/session', methods=['GET'])
def get_session():
    return jsonify({"gemini_active": nlp_engine.has_api})

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part in the request"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
        
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        try:
            cleaner = DataCleaner(file_path)
            summary = cleaner.get_summary()
            
            # Create a clean suggested table name
            base_name = os.path.splitext(filename)[0]
            suggested_table = secure_filename(base_name).lower().replace('-', '_')
            suggested_table = re.sub(r'[^a-z0-9_]', '', suggested_table)
            if not suggested_table or suggested_table[0].isdigit():
                suggested_table = "table_" + suggested_table
            
            add_history_entry("Upload", {
                "filename": filename,
                "rows": summary.get("total_rows", 0),
                "columns_count": summary.get("total_columns", 0)
            })
            
            return jsonify({
                "message": "File uploaded successfully.",
                "file_name": filename,
                "file_path": file_path,
                "suggested_table": suggested_table,
                "summary": summary
            })
            
        except Exception as e:
            if os.path.exists(file_path):
                os.remove(file_path)
            return jsonify({"error": f"Failed to process file: {str(e)}"}), 500
            
    return jsonify({"error": "Unsupported file format. Please upload CSV or Excel."}), 400

@app.route('/delete_upload', methods=['POST'])
def delete_upload():
    data = request.json or {}
    file_name = data.get('file_name')
    file_path = data.get('file_path')

    if not file_name and not file_path:
        return jsonify({"error": "File name or file path is required."}), 400

    if not file_name and file_path:
        abs_upload_folder = os.path.abspath(app.config['UPLOAD_FOLDER'])
        abs_file_path = os.path.abspath(file_path)
        if not abs_file_path.startswith(abs_upload_folder + os.sep):
            return jsonify({"error": "Invalid file path."}), 400
        file_name = os.path.basename(abs_file_path)

    safe_file_name = secure_filename(file_name)
    abs_file_path = os.path.join(app.config['UPLOAD_FOLDER'], safe_file_name)

    try:
        if os.path.exists(abs_file_path):
            os.remove(abs_file_path)
            return jsonify({"message": "Uploaded file removed successfully."})
        return jsonify({"message": "Uploaded file already removed."})
    except Exception as e:
        return jsonify({"error": f"Failed to remove uploaded file: {str(e)}"}), 500

@app.route('/clean', methods=['POST'])
def clean_and_stage():
    data = request.json or {}
    file_name = data.get('file_name')
    file_path = data.get('file_path')
    table_name = data.get('table_name')
    operations = data.get('operations', {})
    
    if not file_name and not file_path:
        return jsonify({"error": "Invalid file name or file path."}), 400

    if not file_name and file_path:
        abs_upload_folder = os.path.abspath(app.config['UPLOAD_FOLDER'])
        abs_file_path = os.path.abspath(file_path)
        if not abs_file_path.startswith(abs_upload_folder + os.sep):
            return jsonify({"error": "Invalid file path."}), 400
        file_name = os.path.basename(abs_file_path)

    safe_file_name = secure_filename(file_name)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], safe_file_name)

    if not os.path.exists(file_path):
        return jsonify({"error": "Invalid file path or file does not exist."}), 400
        
    if not table_name:
        return jsonify({"error": "Table name is required"}), 400
        
    # Clean table name
    table_name = secure_filename(table_name).lower().replace('-', '_')
    
    try:
        cleaner = DataCleaner(file_path)
        # Apply cleaning pipeline
        clean_summary = cleaner.clean(operations)
        # Stage to SQLite
        staging_info = cleaner.stage_to_sqlite(DB_PATH, table_name)
        
        # Clean up temporary uploaded file after staging
        try:
            os.remove(file_path)
        except Exception:
            pass
            
        add_history_entry("Clean & Stage", {
            "table_name": table_name,
            "rows": staging_info.get("row_count", 0),
            "operations": [k for k, v in operations.items() if v]
        })
        
        return jsonify({
            "message": f"Data successfully cleaned and staged to table '{table_name}'.",
            "table_name": table_name,
            "staging_info": staging_info,
            "summary": clean_summary
        })
        
    except Exception as e:
        return jsonify({"error": f"Error running data cleaning: {str(e)}"}), 500

@app.route('/schema', methods=['GET'])
def get_schema():
    if not os.path.exists(DB_PATH):
        return jsonify({"tables": {}})
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Get all tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
        tables = [r[0] for r in cursor.fetchall()]
        
        schema_data = {}
        for table in tables:
            cursor.execute(f"PRAGMA table_info({table});")
            cols = cursor.fetchall()
            # col info format: (cid, name, type, notnull, dflt_value, pk)
            schema_data[table] = [
                {"name": c[1], "type": c[2], "primary_key": bool(c[5])}
                for c in cols
            ]
            
        return jsonify({"tables": schema_data})
    except Exception as e:
        return jsonify({"error": f"Failed to retrieve schema: {str(e)}"}), 500
    finally:
        conn.close()

@app.route('/query', methods=['POST'])
def query_database():
    data = request.json or {}
    user_query = data.get('query')
    table_name = data.get('table_name')
    
    if not user_query:
        return jsonify({"error": "Query is required"}), 400
    if not table_name:
        return jsonify({"error": "Table name is required"}), 400
        
    if not os.path.exists(DB_PATH):
        return jsonify({"error": "Database staging workspace is empty. Please upload and clean a dataset first."}), 400
        
    # Reflect schema of the target table
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Verify table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?;", (table_name,))
        if not cursor.fetchone():
            return jsonify({"error": f"Table '{table_name}' does not exist in staging."}), 404
            
        # Get column definitions
        cursor.execute(f"PRAGMA table_info({table_name});")
        cols = cursor.fetchall()
        schema_dict = {c[1]: c[2] for c in cols}
        
        # Call NL-to-SQL translator
        sql_query = nlp_engine.generate_sql(user_query, table_name, schema_dict)
        
        # Execute generated SQL query safely (Only allow SELECT queries)
        clean_sql = sql_query.strip().lower()
        if not clean_sql.startswith("select"):
            return jsonify({
                "error": "Security Block: Only read-only queries (SELECT) are authorized.",
                "generated_sql": sql_query
            }), 403
            
        cursor.execute(sql_query)
        rows = cursor.fetchall()
        
        # Map back to dict
        columns = [desc[0] for desc in cursor.description]
        results = []
        for r in rows:
            row_dict = {}
            for i, col in enumerate(columns):
                val = r[i]
                # Cast bytes or complex formats to string for JSON output
                if isinstance(val, bytes):
                    val = val.decode('utf-8', errors='ignore')
                row_dict[col] = val
            results.append(row_dict)
            
        add_history_entry("NL Query", {
            "table_name": table_name,
            "nl_query": user_query,
            "sql_query": sql_query,
            "rows_returned": len(results)
        })
        
        return jsonify({
            "generated_sql": sql_query,
            "columns": columns,
            "results": results
        })
        
    except Exception as e:
        return jsonify({
            "error": f"Execution Error: {str(e)}",
            "generated_sql": sql_query if 'sql_query' in locals() else None
        }), 500
    finally:
        conn.close()

@app.route('/insights', methods=['POST'])
def generate_insights():
    data = request.json or {}
    sql_query = data.get('sql_query')
    results = data.get('results', [])
    
    if not sql_query:
        return jsonify({"error": "SQL Query is required"}), 400
        
    try:
        insights = nlp_engine.generate_insights(sql_query, results)
        add_history_entry("Generate Insights", {
            "sql_query": sql_query,
            "insights_count": len(insights)
        })
        return jsonify({"insights": insights})
    except Exception as e:
        return jsonify({"error": f"Failed to generate insights: {str(e)}"}), 500

@app.route('/history', methods=['GET'])
def get_history_logs():
    history = [item for item in get_history() if not is_internal_history_entry(item)]
    return jsonify({"history": history})

@app.route('/clear_history', methods=['POST'])
def clear_history_logs():
    try:
        if os.path.exists(HISTORY_PATH):
            os.remove(HISTORY_PATH)
        return jsonify({"message": "History logs cleared successfully."})
    except Exception as e:
        return jsonify({"error": f"Failed to clear history: {str(e)}"}), 500

if __name__ == '__main__':
    # Make sure app runs on local port 5000
    app.run(debug=True, host='127.0.0.1', port=5000)
