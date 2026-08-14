# Custom NSIS bits injected via electron-builder's nsis.include.

!macro customHeader
  # Restore NSIS's native browse auto-append, which the electron-builder
  # template loses by never declaring a compile-time InstallDir (it assigns
  # $INSTDIR at runtime in initMultiUser instead). The attribute's VALUE is
  # irrelevant — .onInit overwrites $INSTDIR — but its last path component
  # ("DSH Desk") becomes the auto-append name: picking E:\ in the Browse
  # dialog immediately shows E:\DSH Desk in the directory box instead of a
  # scary bare E:\. NSIS only appends when the selected folder's leaf differs
  # (case-insensitive), so re-picking an existing "DSH Desk" folder doesn't
  # nest, and the leaf matches ${APP_FILENAME} exactly, so the template's
  # instFilesPre sanitizer (which appends at install time when the name is
  # absent) stays a consistent no-op double-guard.
  InstallDir "$LOCALAPPDATA\Programs\DSH Desk"
!macroend
