import pandas as pd
import os
import json
from typing import Dict, List, Any
import numpy as np
from openai import OpenAI

# the newest OpenAI model is "gpt-4o" which was released May 13, 2024.
# do not change this unless explicitly requested by the user

# Initialize OpenAI client
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
openai = OpenAI(api_key=OPENAI_API_KEY)

def get_df_info(df: pd.DataFrame) -> str:
    """
    Get information about the dataframe to provide context to the AI.
    
    Args:
        df: Input pandas dataframe
        
    Returns:
        String with dataframe information
    """
    # Basic dataframe info
    info = f"DataFrame shape: {df.shape[0]} rows, {df.shape[1]} columns\n\n"
    
    # Column information
    info += "Columns:\n"
    for col in df.columns:
        dtype = df[col].dtype
        unique_count = df[col].nunique()
        missing_count = df[col].isna().sum()
        missing_pct = (missing_count / len(df)) * 100
        
        info += f"- {col} (type: {dtype}): {unique_count} unique values, {missing_count} missing values ({missing_pct:.1f}%)\n"
    
    # Sample data (first 5 rows)
    info += "\nSample data (first 5 rows):\n"
    sample_data = df.head(5).to_string()
    info += sample_data
    
    # Basic statistics for numeric columns
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    if len(numeric_cols) > 0:
        info += "\n\nNumeric column statistics:\n"
        for col in numeric_cols:
            stats = df[col].describe()
            info += f"- {col}: min={stats['min']:.2f}, max={stats['max']:.2f}, mean={stats['mean']:.2f}, median={stats['50%']:.2f}\n"
    
    # Top categories for categorical columns
    cat_cols = df.select_dtypes(include=['object', 'category']).columns
    if len(cat_cols) > 0:
        info += "\nTop values for categorical columns:\n"
        for col in cat_cols:
            top_vals = df[col].value_counts().head(3)
            if not top_vals.empty:
                info += f"- {col}: "
                for val, count in top_vals.items():
                    info += f"'{val}' ({count} rows, {(count/len(df))*100:.1f}%), "
                info = info[:-2] + "\n"  # Remove last comma
    
    return info

def analyze_data_with_ai(df: pd.DataFrame, question: str) -> str:
    """
    Use OpenAI API to answer questions about the data.
    
    Args:
        df: Input pandas dataframe
        question: User's question about the data
        
    Returns:
        AI response
    """
    if not OPENAI_API_KEY:
        return "Error: OpenAI API key is not set. Please set the OPENAI_API_KEY environment variable."
    
    try:
        # Get dataframe info
        df_info = get_df_info(df)
        
        # Create system message
        system_message = (
            "You are a data analysis assistant that helps users understand their data. "
            "You are given information about a pandas DataFrame and a question from the user. "
            "Provide a clear, concise response that directly answers their question using the data provided. "
            "When appropriate, suggest visualizations or analyses that might help them better understand their data. "
            "If you're unsure or need more information, say so clearly."
        )
        
        # Create user message
        user_message = f"Here is information about my dataset:\n\n{df_info}\n\nMy question is: {question}"
        
        # Call OpenAI API
        response = openai.chat.completions.create(
            model="gpt-4o",  # Using the latest model
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ],
            max_tokens=1000,
            temperature=0.5,  # Lower temperature for more factual responses
        )
        
        return response.choices[0].message.content
    
    except Exception as e:
        return f"Error analyzing data with AI: {str(e)}"

def generate_insights(df: pd.DataFrame) -> List[str]:
    """
    Generate automatic insights about the data using AI.
    
    Args:
        df: Input pandas dataframe
        
    Returns:
        List of insights as strings
    """
    if not OPENAI_API_KEY:
        return ["Error: OpenAI API key is not set. Please set the OPENAI_API_KEY environment variable."]
    
    try:
        # Get dataframe info
        df_info = get_df_info(df)
        
        # Create system message
        system_message = (
            "You are a data analysis assistant that helps users understand their data. "
            "You are given information about a pandas DataFrame. "
            "Generate 5 key insights about this data. Each insight should be specific, "
            "relevant, and provide value to someone trying to understand this dataset. "
            "Focus on patterns, relationships, outliers, and notable statistics. "
            "Respond with a JSON list where each item is a single insight string."
        )
        
        # Create user message
        user_message = f"Here is information about my dataset:\n\n{df_info}\n\nPlease generate 5 key insights about this data."
        
        # Call OpenAI API
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ],
            response_format={"type": "json_object"},
            max_tokens=1000,
            temperature=0.7,
        )
        
        # Parse JSON response
        response_content = response.choices[0].message.content
        insights_data = json.loads(response_content)
        
        if "insights" in insights_data:
            return insights_data["insights"]
        else:
            # If the AI didn't format as expected, try to parse the response more flexibly
            if isinstance(insights_data, list):
                return insights_data
            elif isinstance(insights_data, dict):
                # Find any list in the response
                for key, value in insights_data.items():
                    if isinstance(value, list):
                        return value
            
            # If all else fails, return the raw response
            return [response_content]
    
    except Exception as e:
        return [f"Error generating insights: {str(e)}"]
