# NeuSQL — AI-Powered Data Cleaning & Intelligent SQL Workspace

An end-to-end local data cleaning and intelligent SQL workspace designed to empower business users to transform messy raw datasets into structured intelligence using natural language processing (NL-to-SQL).

## Features
- **Modern Dark UI**: Premium glassmorphic interface with reactive layouts and animations.
- **Data Cleaner**: Pandas-powered pipeline for handling nulls, trimming strings, deduplicating, and casting datatypes.
- **SQLite Staging**: Automatic data staging inside local, lightweight SQLite databases.
- **NL-to-SQL Parser**: Convert plain English questions into valid SQL SELECT statements.
- **Custom Charts**: Render Bar, Line, Pie, and Scatter plots instantly using Chart.js.
- **Audit Logging**: Trace all data processes, uploads, and AI queries step-by-step.
- **strategic Insights**: Summarize results automatically (offline heuristic or online Gemini API).

---

## Quickstart Guide

### 1. Extract Project
Unzip `NeuSQL-ai.zip` into your project directory and open it with VS Code:
```bash
code .
```

### 2. Setup Python Virtual Environment (Recommended)
Open a terminal in VS Code and run:
```bash
# Create virtual environment
python -m venv venv

# Activate on Windows (cmd/powershell):
.\venv\Scripts\activate

# Or on Mac/Linux:
source venv/bin/activate
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Configure Gemini API Key (Optional)
To enable advanced strategic business insights and AI SQL generation, create a `.env` file in the root folder:
```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
```
When a Gemini API key is not configured, the application continues to work using its built-in NL-to-SQL engine and insight generator.

### 5. Launch the Server
```bash
python app.py
```
Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your web browser.

---

## File Structure
- `app.py`: Flask backend server endpoints.
- `requirements.txt`: Python package requirements.
- `utils/cleaner.py`: Cleaning methods and SQLite connections.
- `utils/nlp_engine.py`: NL-to-SQL logic and Gemini API client.
- `templates/index.html`: Responsive frontend HTML template.
- `static/css/style.css`: Glassmorphic stylesheet.
- `static/js/app.js`: Interactive actions, fetch APIs, and charts.

