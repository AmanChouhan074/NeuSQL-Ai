import os
import re
import pandas as pd
import sqlite3

def clean_column_name(col_name):
    """
    Standardize column names: lowercase, replace spaces/special chars with underscores.
    """
    # Convert to string and strip
    col_name = str(col_name).strip()
    # Replace non-alphanumeric chars with underscore
    col_name = re.sub(r'[^a-zA-Z0-9]', '_', col_name)
    # Replace multiple underscores with a single one
    col_name = re.sub(r'_+', '_', col_name)
    # Strip leading/trailing underscores
    col_name = col_name.strip('_')
    # Lowercase
    return col_name.lower() or "unnamed_column"

def detect_and_convert_types(df):
    """
    Automatically detect datatypes and convert them.
    - Dates: if string looks like a date, convert to datetime.
    - Numeric: try to convert to numeric if possible.
    """
    for col in df.columns:
        # If column is already numeric, leave it
        if pd.api.types.is_numeric_dtype(df[col]):
            continue
        
        # Try converting to datetime
        # We check if it's a string type first
        if df[col].dtype == 'object':
            # Drop na for checking
            sample = df[col].dropna().astype(str)
            if not sample.empty:
                # Try simple regex checks for date formats: e.g. YYYY-MM-DD or MM/DD/YYYY
                date_match = sample.apply(lambda x: bool(re.match(r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}', x) or re.match(r'^\d{1,2}[-/]\d{1,2}[-/]\d{4}', x)))
                if date_match.mean() > 0.8: # If 80%+ match, try datetime conversion
                    try:
                        df[col] = pd.to_datetime(df[col], errors='coerce')
                        continue
                    except Exception:
                        pass
        
        # Try converting to numeric (int/float)
        if df[col].dtype == 'object':
            sample = df[col].dropna().astype(str)
            if not sample.empty:
                # Remove currency symbols or commas for checking numeric
                numeric_sample = sample.apply(lambda x: re.sub(r'[$,%]', '', x))
                numeric_match = numeric_sample.apply(lambda x: bool(re.match(r'^-?\d+(\.\d+)?$', x.strip())))
                if numeric_match.mean() > 0.8:
                    try:
                        df[col] = pd.to_numeric(numeric_sample, errors='coerce')
                    except Exception:
                        pass
    return df

class DataCleaner:
    def __init__(self, file_path):
        self.file_path = file_path
        self.file_ext = os.path.splitext(file_path)[1].lower()
        self.df = None
        self.load_data()

    def load_data(self):
        """Loads CSV or Excel file into a Pandas DataFrame."""
        if self.file_ext == '.csv':
            self.df = pd.read_csv(self.file_path)
        elif self.file_ext in ['.xls', '.xlsx']:
            self.df = pd.read_excel(self.file_path)
        else:
            raise ValueError(f"Unsupported file format: {self.file_ext}. Only CSV and Excel are supported.")
        
        # Standardize columns immediately upon loading
        self.df.columns = [clean_column_name(col) for col in self.df.columns]

    def get_summary(self):
        """Returns metadata summary of the dataset."""
        if self.df is None:
            return {}
        
        summary = []
        for col in self.df.columns:
            null_count = int(self.df[col].isnull().sum())
            null_pct = float((null_count / len(self.df)) * 100) if len(self.df) > 0 else 0
            unique_count = int(self.df[col].nunique())
            
            summary.append({
                "column_name": col,
                "data_type": str(self.df[col].dtype),
                "null_count": null_count,
                "null_percent": round(null_pct, 2),
                "unique_values": unique_count,
                "sample_values": list(self.df[col].dropna().head(3).astype(str))
            })
            
        return {
            "total_rows": len(self.df),
            "total_columns": len(self.df.columns),
            "columns": summary
        }

    def clean(self, operations):
        """
        Executes cleaning operations on the dataset.
        operations: dict of config options:
          - remove_duplicates: bool
          - fill_missing: str ('mean', 'median', 'mode', 'drop', or 'placeholder')
          - trim_whitespace: bool
          - convert_types: bool
        """
        if self.df is None:
            return
        
        # 1. Trim Whitespace
        if operations.get('trim_whitespace', True):
            for col in self.df.columns:
                if self.df[col].dtype == 'object':
                    self.df[col] = self.df[col].astype(str).str.strip()

        # 2. Convert Data Types
        if operations.get('convert_types', True):
            self.df = detect_and_convert_types(self.df)

        # 3. Handle Missing Values
        fill_strategy = operations.get('fill_missing', 'placeholder')
        if fill_strategy == 'drop':
            self.df = self.df.dropna()
        elif fill_strategy in ['mean', 'median', 'mode', 'placeholder']:
            for col in self.df.columns:
                if self.df[col].isnull().sum() == 0:
                    continue
                
                if pd.api.types.is_numeric_dtype(self.df[col]):
                    if fill_strategy == 'mean':
                        self.df[col] = self.df[col].fillna(self.df[col].mean())
                    elif fill_strategy == 'median':
                        self.df[col] = self.df[col].fillna(self.df[col].median())
                    else: # placeholder/mode
                        self.df[col] = self.df[col].fillna(0)
                else: # Non-numeric (categorical, string, datetime)
                    if fill_strategy == 'mode' and not self.df[col].mode().empty:
                        self.df[col] = self.df[col].fillna(self.df[col].mode()[0])
                    else:
                        if pd.api.types.is_datetime64_any_dtype(self.df[col]):
                            # For dates, fill with first non-null or current date
                            self.df[col] = self.df[col].fillna(method='ffill').fillna(method='bfill')
                        else:
                            self.df[col] = self.df[col].fillna("Unknown")

        # 4. Remove Duplicates
        if operations.get('remove_duplicates', True):
            self.df = self.df.drop_duplicates()

        return self.get_summary()

    def stage_to_sqlite(self, db_path, table_name):
        """
        Saves the DataFrame as a table inside a SQLite database.
        """
        if self.df is None:
            raise ValueError("No data loaded to stage.")
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        
        conn = sqlite3.connect(db_path)
        try:
            # We save dates as strings in SQLite, pandas to_sql does this automatically
            self.df.to_sql(table_name, conn, if_exists='replace', index=False)
            conn.commit()
        finally:
            conn.close()
            
        return {
            "database": os.path.basename(db_path),
            "table": table_name,
            "row_count": len(self.df)
        }
