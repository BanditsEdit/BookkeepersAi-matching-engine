import pandas as pd
import numpy as np
from typing import List, Dict, Any, Tuple

def process_data(df: pd.DataFrame) -> pd.DataFrame:
    """
    Process the input dataframe to handle missing values, 
    convert data types, and other preprocessing steps.
    
    Args:
        df: Input pandas dataframe
        
    Returns:
        Processed pandas dataframe
    """
    # Make a copy to avoid modifying the original
    processed_df = df.copy()
    
    # Detect and handle missing values
    for col in processed_df.columns:
        missing_count = processed_df[col].isna().sum()
        missing_pct = missing_count / len(processed_df)
        
        # If column is numeric, fill missing values with median
        if pd.api.types.is_numeric_dtype(processed_df[col]):
            if missing_count > 0:
                median_val = processed_df[col].median()
                processed_df[col].fillna(median_val, inplace=True)
        
        # If column is categorical or string, fill with mode
        elif pd.api.types.is_string_dtype(processed_df[col]) or pd.api.types.is_categorical_dtype(processed_df[col]):
            if missing_count > 0:
                mode_val = processed_df[col].mode()[0]
                processed_df[col].fillna(mode_val, inplace=True)
        
        # For datetime columns, fill with previous value
        elif pd.api.types.is_datetime64_dtype(processed_df[col]):
            if missing_count > 0:
                processed_df[col].fillna(method='ffill', inplace=True)
                # If still has missing values (e.g., at the beginning), fill with next value
                processed_df[col].fillna(method='bfill', inplace=True)
    
    # Try to convert string columns that are actually numeric
    for col in processed_df.select_dtypes(include=['object']).columns:
        try:
            processed_df[col] = pd.to_numeric(processed_df[col])
        except:
            # If conversion fails, keep as is
            pass
    
    # Try to parse date columns if column name suggests it might be a date
    date_indicators = ['date', 'time', 'year', 'month', 'day']
    for col in processed_df.select_dtypes(exclude=['datetime64']).columns:
        if any(indicator in col.lower() for indicator in date_indicators):
            try:
                processed_df[col] = pd.to_datetime(processed_df[col])
            except:
                # If conversion fails, keep as is
                pass
    
    return processed_df

def get_summary_statistics(df: pd.DataFrame) -> pd.DataFrame:
    """
    Generate summary statistics for the dataframe.
    
    Args:
        df: Input pandas dataframe
        
    Returns:
        DataFrame with summary statistics
    """
    # Summary for numeric columns
    numeric_summary = df.describe(include=[np.number]).T
    
    # Add more metrics
    if not numeric_summary.empty:
        numeric_summary['missing'] = df[numeric_summary.index].isna().sum()
        numeric_summary['missing_pct'] = (df[numeric_summary.index].isna().sum() / len(df)) * 100
        numeric_summary['unique'] = df[numeric_summary.index].nunique()
    
    # Summary for non-numeric columns
    categorical_summary = pd.DataFrame()
    cat_cols = df.select_dtypes(exclude=[np.number]).columns
    
    if len(cat_cols) > 0:
        categorical_summary = pd.DataFrame(index=cat_cols)
        categorical_summary['type'] = [str(df[col].dtype) for col in cat_cols]
        categorical_summary['missing'] = df[cat_cols].isna().sum()
        categorical_summary['missing_pct'] = (df[cat_cols].isna().sum() / len(df)) * 100
        categorical_summary['unique'] = df[cat_cols].nunique()
        categorical_summary['most_common'] = [df[col].value_counts().index[0] if not df[col].value_counts().empty else None for col in cat_cols]
        categorical_summary['frequency'] = [df[col].value_counts().iloc[0] if not df[col].value_counts().empty else None for col in cat_cols]
    
    # Combine summaries
    if not numeric_summary.empty and not categorical_summary.empty:
        numeric_summary['type'] = [str(df[col].dtype) for col in numeric_summary.index]
        combined_summary = pd.concat([numeric_summary, categorical_summary], sort=False)
        # Reorder columns to put type first
        cols = combined_summary.columns.tolist()
        cols.insert(0, cols.pop(cols.index('type')))
        combined_summary = combined_summary[cols]
        return combined_summary
    elif not numeric_summary.empty:
        numeric_summary['type'] = [str(df[col].dtype) for col in numeric_summary.index]
        cols = numeric_summary.columns.tolist()
        cols.insert(0, cols.pop(cols.index('type')))
        return numeric_summary[cols]
    else:
        return categorical_summary
    
def detect_trends(df: pd.DataFrame) -> List[str]:
    """
    Detect trends and insights in the dataframe.
    
    Args:
        df: Input pandas dataframe
        
    Returns:
        List of insights as strings
    """
    insights = []
    
    # Check if dataframe is empty
    if df.empty:
        insights.append("The dataset is empty.")
        return insights
    
    # Get basic info
    insights.append(f"Dataset has {df.shape[0]} rows and {df.shape[1]} columns.")
    
    # Check for missing values
    missing_cols = df.columns[df.isna().any()].tolist()
    if missing_cols:
        insights.append(f"Found missing values in {len(missing_cols)} columns: {', '.join(missing_cols[:3])}{'...' if len(missing_cols) > 3 else ''}")
    
    # Analyze numeric columns
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    if len(numeric_cols) > 0:
        # Look for highly skewed columns
        for col in numeric_cols:
            skew = df[col].skew()
            if abs(skew) > 1.5:
                direction = "right" if skew > 0 else "left"
                insights.append(f"Column '{col}' is highly skewed to the {direction} (skew={skew:.2f}).")
        
        # Look for columns with outliers
        for col in numeric_cols:
            q1 = df[col].quantile(0.25)
            q3 = df[col].quantile(0.75)
            iqr = q3 - q1
            lower_bound = q1 - 1.5 * iqr
            upper_bound = q3 + 1.5 * iqr
            outliers = df[(df[col] < lower_bound) | (df[col] > upper_bound)][col]
            if len(outliers) > 0:
                pct_outliers = (len(outliers) / len(df)) * 100
                if pct_outliers > 1:  # Only report if more than 1% are outliers
                    insights.append(f"Column '{col}' has {len(outliers)} outliers ({pct_outliers:.1f}% of data).")
        
        # Look for correlations between numeric columns
        if len(numeric_cols) >= 2:
            corr_matrix = df[numeric_cols].corr()
            high_corrs = []
            for i in range(len(numeric_cols)):
                for j in range(i+1, len(numeric_cols)):
                    if abs(corr_matrix.iloc[i, j]) > 0.7:  # Strong correlation threshold
                        high_corrs.append((numeric_cols[i], numeric_cols[j], corr_matrix.iloc[i, j]))
            
            if high_corrs:
                # Sort by correlation strength
                high_corrs.sort(key=lambda x: abs(x[2]), reverse=True)
                for col1, col2, corr in high_corrs[:3]:  # Report top 3
                    corr_type = "positive" if corr > 0 else "negative"
                    insights.append(f"Strong {corr_type} correlation ({corr:.2f}) between '{col1}' and '{col2}'.")
    
    # Analyze categorical columns
    cat_cols = df.select_dtypes(exclude=[np.number]).columns
    if len(cat_cols) > 0:
        for col in cat_cols:
            value_counts = df[col].value_counts()
            if len(value_counts) == 1:
                insights.append(f"Column '{col}' has only one unique value: '{value_counts.index[0]}'.")
            elif len(value_counts) <= 5 and len(df) > 10:  # Only for reasonably sized datasets
                top_val = value_counts.index[0]
                top_pct = (value_counts.iloc[0] / len(df)) * 100
                if top_pct > 75:
                    insights.append(f"Column '{col}' is dominated by '{top_val}' ({top_pct:.1f}% of data).")
    
    # Check for time-based columns and trends
    date_cols = df.select_dtypes(include=['datetime64']).columns
    if len(date_cols) > 0:
        for col in date_cols:
            # Check time span
            min_date = df[col].min()
            max_date = df[col].max()
            date_range = max_date - min_date
            insights.append(f"Time column '{col}' spans from {min_date.date()} to {max_date.date()} ({date_range.days} days).")
            
            # If we have numeric columns, check for time-based trends
            if len(numeric_cols) > 0 and len(df) >= 10:
                for num_col in numeric_cols[:3]:  # Check first 3 numeric columns
                    try:
                        # Sort by date and compute difference between last and first value
                        df_sorted = df.sort_values(col)
                        first_val = df_sorted[num_col].iloc[0]
                        last_val = df_sorted[num_col].iloc[-1]
                        if first_val != 0:
                            change_pct = ((last_val - first_val) / abs(first_val)) * 100
                            if abs(change_pct) > 20:  # Significant change
                                direction = "increased" if change_pct > 0 else "decreased"
                                insights.append(f"'{num_col}' has {direction} by {abs(change_pct):.1f}% over the time period.")
                    except:
                        continue
    
    # Limit to top 10 insights
    if len(insights) > 10:
        insights = insights[:10]
    
    return insights
