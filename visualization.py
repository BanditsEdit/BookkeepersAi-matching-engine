import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from typing import Dict, List, Optional, Any

def get_visualization_options(df: pd.DataFrame) -> Dict:
    """
    Get available visualization options based on the dataframe.
    
    Args:
        df: Input pandas dataframe
        
    Returns:
        Dictionary with visualization options
    """
    # Categorize columns
    numeric_columns = df.select_dtypes(include=['number']).columns.tolist()
    categorical_columns = df.select_dtypes(include=['object', 'category', 'bool']).columns.tolist()
    datetime_columns = df.select_dtypes(include=['datetime']).columns.tolist()
    
    # Determine available visualization types based on data
    viz_types = ['scatter', 'line', 'bar', 'histogram', 'box', 'violin', 'pie']
    
    # If we have datetime columns, add time series
    if datetime_columns:
        viz_types.append('time series')
    
    # If we have at least 3 numeric columns, add 3D scatter
    if len(numeric_columns) >= 3:
        viz_types.append('3d scatter')
    
    # If we have both numeric and categorical columns, add heatmap
    if len(numeric_columns) >= 1 and len(categorical_columns) >= 1:
        viz_types.append('heatmap')
    
    return {
        'numeric_columns': numeric_columns,
        'categorical_columns': categorical_columns + datetime_columns,
        'datetime_columns': datetime_columns,
        'viz_types': viz_types
    }

def create_visualization(
    df: pd.DataFrame,
    viz_type: str,
    x_column: str,
    y_column: Optional[str] = None,
    color_by: Optional[str] = None,
    size_by: Optional[str] = None,
    bins: int = 20,
    title: str = "Visualization",
    **kwargs
) -> go.Figure:
    """
    Create a visualization based on the specified type and columns.
    
    Args:
        df: Input pandas dataframe
        viz_type: Type of visualization
        x_column: Column for x-axis
        y_column: Column for y-axis (optional for some viz types)
        color_by: Column to color by (optional)
        size_by: Column to size by (optional, for scatter plots)
        bins: Number of bins (for histograms)
        title: Title of the visualization
        
    Returns:
        Plotly figure object
    """
    # Handle specific visualization types
    if viz_type == 'scatter':
        if y_column:
            fig = px.scatter(
                df, x=x_column, y=y_column,
                color=color_by if color_by else None,
                size=size_by if size_by else None,
                hover_data=df.columns,
                title=title
            )
        else:
            fig = px.scatter(
                df, x=x_column,
                color=color_by if color_by else None,
                size=size_by if size_by else None,
                hover_data=df.columns,
                title=title
            )
    
    elif viz_type == 'line':
        if y_column:
            fig = px.line(
                df, x=x_column, y=y_column,
                color=color_by if color_by else None,
                title=title
            )
        else:
            fig = px.line(
                df, x=x_column,
                color=color_by if color_by else None,
                title=title
            )
    
    elif viz_type == 'bar':
        if y_column:
            fig = px.bar(
                df, x=x_column, y=y_column,
                color=color_by if color_by else None,
                title=title
            )
        else:
            # Create count-based bar chart
            fig = px.bar(
                df, x=x_column,
                color=color_by if color_by else None,
                title=title
            )
    
    elif viz_type == 'histogram':
        fig = px.histogram(
            df, x=x_column,
            color=color_by if color_by else None,
            nbins=bins,
            title=title
        )
    
    elif viz_type == 'box':
        if y_column:
            fig = px.box(
                df, x=x_column, y=y_column,
                color=color_by if color_by else None,
                title=title
            )
        else:
            fig = px.box(
                df, x=x_column,
                color=color_by if color_by else None,
                title=title
            )
    
    elif viz_type == 'violin':
        if y_column:
            fig = px.violin(
                df, x=x_column, y=y_column,
                color=color_by if color_by else None,
                title=title
            )
        else:
            fig = px.violin(
                df, x=x_column,
                color=color_by if color_by else None,
                title=title
            )
    
    elif viz_type == 'pie':
        # For pie charts, we need to handle the values
        if y_column and y_column != 'None':
            # Group by x_column and sum y_column
            pie_data = df.groupby(x_column)[y_column].sum().reset_index()
            fig = px.pie(
                pie_data, names=x_column, values=y_column,
                title=title
            )
        else:
            # Use counts as values
            value_counts = df[x_column].value_counts().reset_index()
            value_counts.columns = [x_column, 'count']
            fig = px.pie(
                value_counts, names=x_column, values='count',
                title=title
            )
    
    elif viz_type == 'time series':
        # Check if x_column is datetime, if not try to convert
        if df[x_column].dtype != 'datetime64[ns]':
            try:
                df = df.copy()
                df[x_column] = pd.to_datetime(df[x_column])
            except:
                raise ValueError(f"Could not convert {x_column} to datetime format")
        
        if y_column:
            fig = px.line(
                df, x=x_column, y=y_column,
                color=color_by if color_by else None,
                title=title
            )
        else:
            # Use count if no y_column specified
            time_counts = df.groupby(pd.Grouper(key=x_column, freq='D')).size().reset_index(name='count')
            fig = px.line(
                time_counts, x=x_column, y='count',
                title=title
            )
    
    elif viz_type == '3d scatter':
        # Ensure we have 3 numeric columns
        if not y_column:
            raise ValueError("Y-axis column required for 3D scatter plot")
        
        # Get a third numeric column for z-axis
        numeric_cols = df.select_dtypes(include=['number']).columns.tolist()
        z_options = [col for col in numeric_cols if col != x_column and col != y_column]
        
        if not z_options:
            raise ValueError("Need at least 3 numeric columns for 3D scatter plot")
        
        z_column = z_options[0]
        
        fig = px.scatter_3d(
            df, x=x_column, y=y_column, z=z_column,
            color=color_by if color_by else None,
            size=size_by if size_by else None,
            title=title
        )
    
    elif viz_type == 'heatmap':
        # Create pivot table for heatmap
        if not y_column:
            raise ValueError("Y-axis column required for heatmap")
        
        # Use correlation matrix if both columns are numeric
        if df[x_column].dtype.kind in 'bfc' and df[y_column].dtype.kind in 'bfc':
            corr_df = df.corr()
            fig = px.imshow(
                corr_df, 
                title="Correlation Heatmap"
            )
        else:
            # Create a crosstab
            try:
                if color_by and color_by != 'None':
                    # Use color_by as values
                    pivot_table = pd.pivot_table(
                        df, values=color_by, index=y_column, columns=x_column,
                        aggfunc='mean'
                    )
                else:
                    # Use counts
                    pivot_table = pd.crosstab(df[y_column], df[x_column])
                
                fig = px.imshow(
                    pivot_table,
                    title=title
                )
            except Exception as e:
                raise ValueError(f"Could not create heatmap: {e}")
    
    else:
        raise ValueError(f"Unsupported visualization type: {viz_type}")
    
    # Update layout for better appearance
    fig.update_layout(
        title={
            'text': title,
            'y':0.95,
            'x':0.5,
            'xanchor': 'center',
            'yanchor': 'top'
        },
        xaxis_title=x_column,
        yaxis_title=y_column if y_column else "Count",
        legend_title=color_by if color_by else "Legend"
    )
    
    return fig
