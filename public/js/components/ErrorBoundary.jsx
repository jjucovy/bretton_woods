        // Error Boundary Component
        class ErrorBoundary extends React.Component {
          constructor(props) {
            super(props);
            this.state = { hasError: false, error: null, errorInfo: null };
          }

          static getDerivedStateFromError(error) {
            return { hasError: true };
          }

          componentDidCatch(error, errorInfo) {
            console.error('!!! REACT ERROR CAUGHT !!!');
            console.error('Error:', error);
            console.error('Error Info:', errorInfo);
            this.setState({ error, errorInfo });
          }

          render() {
            if (this.state.hasError) {
              return (
                <div className="container">
                  <div className="card">
                    <h2 style={{ color: '#dc2626' }}>Something Went Wrong</h2>
                    <p>The game encountered an unexpected error. Please try refreshing.</p>
                    <button
                      onClick={() => window.location.reload()}
                      className="btn-primary"
                      style={{ marginTop: '20px' }}
                    >
                      Reload Page
                    </button>
                  </div>
                </div>
              );
            }

            return this.props.children;
          }
        }

window.ErrorBoundary = ErrorBoundary;
