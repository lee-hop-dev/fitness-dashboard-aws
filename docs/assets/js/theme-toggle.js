// Theme Toggle System
(function() {
  // Check for saved theme preference or default to 'dark'
  const savedTheme = localStorage.getItem('theme') || 'dark';
  
  // Apply theme immediately to prevent flash
  document.documentElement.setAttribute('data-theme', savedTheme);
  
  // Function to toggle theme
  window.toggleTheme = function() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Update toggle icon
    updateToggleIcon(newTheme);
  };
  
  // Update toggle icon based on theme
  function updateToggleIcon(theme) {
    const icon = document.querySelector('.theme-icon');
    if (icon) {
      icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  }
  
  // Initialize icon when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    updateToggleIcon(savedTheme);
  });
})();
