; NSIS hooks for the Windows installer (bundle.windows.nsis.installerHooks).
;
; The bundled engine (resources/engine) is a PyInstaller folder whose
; contents change between versions. Installing over an older version only
; copies the new files, so folders an old engine had and the new one doesn't
; stay behind - and Python imports an empty leftover folder as a package
; (empty "websockets" and "httptools" folders crashed the 0.1.2 and 0.1.3
; engines).
; Removing the whole engine folder first gives every install a clean copy.

!macro NSIS_HOOK_PREINSTALL
  RMDir /r "$INSTDIR\engine"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  RMDir /r "$INSTDIR\engine"
!macroend
