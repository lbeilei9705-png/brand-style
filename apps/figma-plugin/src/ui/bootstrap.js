
      initializeMemberSession()
        .then(async (isAuthenticated) => {
          if (!isAuthenticated) {
            updateRunState();
            return;
          }

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
