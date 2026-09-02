      Promise.all([initializeVersionCompatibility(), initializeMemberSession()])
        .then(async ([, isAuthenticated]) => {
          if (!isAuthenticated) {
            updateRunState();
            return;
          }

          trackPluginStarted();
          await loadConfig();
          updateRunState();
          scheduleInitialComposerActionsScroll();
        })
        .catch((error) => {
          addMessage("system", getReadableError(error));
        });
    </script>
  </body>
</html>
