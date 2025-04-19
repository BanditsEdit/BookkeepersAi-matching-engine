import streamlit as st
import pandas as pd
import os
import io
import base64
from data_processor import process_data, get_summary_statistics, detect_trends
from visualization import create_visualization, get_visualization_options
from chatbot import analyze_data_with_ai
from utils import save_dataframe, load_dataframe, convert_df_to_csv, convert_fig_to_html

st.set_page_config(
    page_title="DataInsight AI - Data Analysis Tool",
    page_icon="📊",
    layout="wide"
)

# Initialize session state variables
if 'df' not in st.session_state:
    st.session_state.df = None
if 'file_name' not in st.session_state:
    st.session_state.file_name = None
if 'chat_history' not in st.session_state:
    st.session_state.chat_history = []
if 'current_viz' not in st.session_state:
    st.session_state.current_viz = None

# Application header
st.title("DataInsight AI 📊")
st.subheader("Data Analysis and Visualization Tool with AI Assistant")

# Main navigation
tab1, tab2, tab3 = st.tabs(["Data Upload & Analysis", "Visualization", "Data Chatbot"])

with tab1:
    st.header("Upload and Analyze Your Data")
    
    col1, col2 = st.columns([3, 2])
    
    with col1:
        uploaded_file = st.file_uploader("Choose a CSV or Excel file", type=["csv", "xlsx", "xls"])
        
        if uploaded_file is not None:
            try:
                file_type = uploaded_file.name.split('.')[-1]
                
                if file_type == 'csv':
                    df = pd.read_csv(uploaded_file)
                else:
                    df = pd.read_excel(uploaded_file)
                
                st.session_state.df = df
                st.session_state.file_name = uploaded_file.name
                
                # Process data (handle missing values, etc.)
                st.session_state.df = process_data(st.session_state.df)
                
                st.success(f"Successfully loaded {uploaded_file.name} with {df.shape[0]} rows and {df.shape[1]} columns.")
            except Exception as e:
                st.error(f"Error loading file: {e}")
    
    with col2:
        if st.session_state.df is not None:
            st.subheader("Data Preview")
            st.dataframe(st.session_state.df.head(5))
            
            # Data download option
            csv = convert_df_to_csv(st.session_state.df)
            st.download_button(
                label="Download processed data as CSV",
                data=csv,
                file_name=f"processed_{st.session_state.file_name.split('.')[0]}.csv",
                mime="text/csv",
            )
    
    # Data Analysis Section
    if st.session_state.df is not None:
        st.header("Data Analysis")
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("Summary Statistics")
            stats_df = get_summary_statistics(st.session_state.df)
            st.dataframe(stats_df)
        
        with col2:
            st.subheader("Data Trends and Insights")
            trends = detect_trends(st.session_state.df)
            for trend in trends:
                st.info(trend)

with tab2:
    st.header("Create Interactive Visualizations")
    
    if st.session_state.df is not None:
        col1, col2 = st.columns([1, 3])
        
        with col1:
            st.subheader("Visualization Options")
            
            viz_options = get_visualization_options(st.session_state.df)
            
            viz_type = st.selectbox("Select visualization type", viz_options['viz_types'])
            
            x_axis = st.selectbox(
                "Select X-axis column",
                options=viz_options['numeric_columns'] + viz_options['categorical_columns'],
                index=0
            )
            
            compatible_columns = viz_options['numeric_columns']
            if viz_type in ['bar', 'pie', 'histogram']:
                compatible_columns = viz_options['numeric_columns'] + viz_options['categorical_columns']
            
            y_axis = st.selectbox(
                "Select Y-axis column (if applicable)",
                options=['None'] + compatible_columns,
                index=0 if viz_type in ['pie', 'histogram'] else (1 if len(compatible_columns) > 0 else 0)
            )
            
            color_by = st.selectbox(
                "Color by (optional)",
                options=['None'] + viz_options['categorical_columns'],
                index=0
            )
            
            # Additional options based on viz type
            additional_options = {}
            
            if viz_type == 'scatter':
                size_by = st.selectbox(
                    "Size by (optional)",
                    options=['None'] + viz_options['numeric_columns'],
                    index=0
                )
                additional_options['size_by'] = None if size_by == 'None' else size_by
            
            if viz_type == 'histogram':
                bins = st.slider("Number of bins", min_value=5, max_value=100, value=20)
                additional_options['bins'] = bins
            
            title = st.text_input("Chart title", f"{viz_type.capitalize()} of {y_axis if y_axis != 'None' else x_axis}")
            additional_options['title'] = title
            
            if st.button("Generate Visualization"):
                with st.spinner("Creating visualization..."):
                    y_axis_val = None if y_axis == 'None' else y_axis
                    color_by_val = None if color_by == 'None' else color_by
                    
                    fig = create_visualization(
                        df=st.session_state.df,
                        viz_type=viz_type,
                        x_column=x_axis,
                        y_column=y_axis_val,
                        color_by=color_by_val,
                        **additional_options
                    )
                    
                    st.session_state.current_viz = {
                        'fig': fig,
                        'type': viz_type,
                        'title': title
                    }
        
        with col2:
            st.subheader("Visualization Preview")
            
            if st.session_state.current_viz:
                st.plotly_chart(st.session_state.current_viz['fig'], use_container_width=True)
                
                # Export options
                st.subheader("Export Options")
                
                col1, col2 = st.columns(2)
                
                with col1:
                    html_code = convert_fig_to_html(st.session_state.current_viz['fig'])
                    st.download_button(
                        label="Download as HTML",
                        data=html_code,
                        file_name=f"{st.session_state.current_viz['title'].replace(' ', '_')}.html",
                        mime="text/html"
                    )
                
                with col2:
                    img_bytes = st.session_state.current_viz['fig'].to_image(format="png")
                    st.download_button(
                        label="Download as PNG",
                        data=img_bytes,
                        file_name=f"{st.session_state.current_viz['title'].replace(' ', '_')}.png",
                        mime="image/png"
                    )
    else:
        st.info("Please upload data in the 'Data Upload & Analysis' tab to create visualizations.")

with tab3:
    st.header("Chat with Your Data")
    
    if st.session_state.df is not None:
        col1, col2 = st.columns([3, 1])
        
        with col1:
            st.subheader("Data Chatbot")
            
            # Display chat history
            for i, chat in enumerate(st.session_state.chat_history):
                if chat["role"] == "user":
                    st.markdown(f"**You:** {chat['content']}")
                else:
                    st.markdown(f"**AI Assistant:** {chat['content']}")
            
            # Input for new questions
            user_question = st.text_input("Ask a question about your data:", key="user_question")
            
            if st.button("Send", key="send_button"):
                if user_question:
                    # Add user question to chat history
                    st.session_state.chat_history.append({
                        "role": "user",
                        "content": user_question
                    })
                    
                    # Get AI response
                    with st.spinner("Thinking..."):
                        try:
                            response = analyze_data_with_ai(st.session_state.df, user_question)
                            
                            # Add AI response to chat history
                            st.session_state.chat_history.append({
                                "role": "assistant",
                                "content": response
                            })
                            
                            st.rerun()
                        except Exception as e:
                            st.error(f"Error getting response: {e}")
        
        with col2:
            st.subheader("Suggested Questions")
            
            # Provide some example questions based on the data
            suggested_questions = [
                f"What is the average of {col}?" for col in st.session_state.df.select_dtypes(include=['number']).columns[:3]
            ]
            
            suggested_questions.extend([
                "Summarize the key trends in this data",
                "What insights can you find from this dataset?",
                "What columns have the strongest correlation?",
                "Are there any outliers in the data?"
            ])
            
            for q in suggested_questions[:5]:  # Limit to 5 suggestions
                if st.button(q, key=f"suggested_{q}"):
                    # Add question to chat input
                    st.session_state.user_question = q
                    st.rerun()
    else:
        st.info("Please upload data in the 'Data Upload & Analysis' tab to chat with your data.")

# Footer
st.markdown("---")
st.markdown("DataInsight AI - A Data Analysis Tool for Data Teams")
