import pandas as pd
import plotly.graph_objects as go
import base64
import io
import json
import os
from typing import Dict, Any

def save_dataframe(df: pd.DataFrame, file_name: str) -> bool:
    """
    Save dataframe to a temporary file.
    
    Args:
        df: Pandas dataframe to save
        file_name: Name of the file to save
        
    Returns:
        Boolean indicating success or failure
    """
    try:
        # Create temp directory if it doesn't exist
        temp_dir = "./temp"
        os.makedirs(temp_dir, exist_ok=True)
        
        # Save file
        file_path = os.path.join(temp_dir, file_name)
        if file_name.endswith('.csv'):
            df.to_csv(file_path, index=False)
        elif file_name.endswith(('.xlsx', '.xls')):
            df.to_excel(file_path, index=False)
        else:
            # Default to csv
            file_path = os.path.join(temp_dir, f"{file_name}.csv")
            df.to_csv(file_path, index=False)
        
        return True
    except Exception as e:
        print(f"Error saving dataframe: {e}")
        return False

def load_dataframe(file_path: str) -> pd.DataFrame:
    """
    Load dataframe from a file.
    
    Args:
        file_path: Path to the file
        
    Returns:
        Pandas dataframe
    """
    if file_path.endswith('.csv'):
        return pd.read_csv(file_path)
    elif file_path.endswith(('.xlsx', '.xls')):
        return pd.read_excel(file_path)
    else:
        raise ValueError(f"Unsupported file format: {file_path}")

def convert_df_to_csv(df: pd.DataFrame) -> str:
    """
    Convert dataframe to CSV string for download.
    
    Args:
        df: Pandas dataframe
        
    Returns:
        CSV string
    """
    return df.to_csv(index=False).encode('utf-8')

def convert_fig_to_html(fig: go.Figure) -> str:
    """
    Convert Plotly figure to HTML for download.
    
    Args:
        fig: Plotly figure
        
    Returns:
        HTML string
    """
    html = fig.to_html(include_plotlyjs='cdn')
    
    # Add standalone wrapper
    full_html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>DataInsight AI Visualization</title>
        <style>
            body {{
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 20px;
                background-color: #f5f5f5;
            }}
            .container {{
                max-width: 1200px;
                margin: 0 auto;
                background-color: white;
                padding: 20px;
                border-radius: 5px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            }}
            h1 {{
                color: #333;
                text-align: center;
            }}
            .footer {{
                margin-top: 30px;
                text-align: center;
                font-size: 12px;
                color: #666;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>DataInsight AI Visualization</h1>
            <div id="viz-container">
                {html}
            </div>
            <div class="footer">
                Generated with DataInsight AI
            </div>
        </div>
    </body>
    </html>
    """
    
    return full_html

def get_file_extension(file_name: str) -> str:
    """
    Get the extension of a file name.
    
    Args:
        file_name: Name of the file
        
    Returns:
        File extension
    """
    return os.path.splitext(file_name)[1].lower()

def is_valid_file_type(file_name: str, allowed_extensions: list) -> bool:
    """
    Check if a file has a valid extension.
    
    Args:
        file_name: Name of the file
        allowed_extensions: List of allowed extensions
        
    Returns:
        Boolean indicating whether the file type is valid
    """
    extension = get_file_extension(file_name)
    return extension in allowed_extensions
