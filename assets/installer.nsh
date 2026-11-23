!ifndef BUILD_UNINSTALLER
!include nsDialogs.nsh

Var PluginCsv
Var PluginImu
Var PluginMemory
Var PluginTemplate
Var PluginSystemId
Var PluginCsvControl
Var PluginImuControl
Var PluginMemoryControl
Var PluginTemplateControl
Var PluginSetupControl
Var PluginSetup
Var PluginSystemIdControl

# Capture choices before electron-builder removes the previous installation. Missing
# files indicate a fresh installation (or an older release), where all are selected.
Function ReadPluginSelection
  StrCpy $PluginCsv ${BST_CHECKED}
  StrCpy $PluginImu ${BST_CHECKED}
  StrCpy $PluginMemory ${BST_CHECKED}
  StrCpy $PluginTemplate ${BST_CHECKED}
  StrCpy $PluginSystemId ${BST_CHECKED}
  StrCpy $PluginSetup ${BST_CHECKED}
  IfFileExists "$INSTDIR\resources\plugin-selection.ini" 0 done
  ReadINIStr $PluginCsv "$INSTDIR\resources\plugin-selection.ini" "plugins" "csv-recorder"
  ReadINIStr $PluginImu "$INSTDIR\resources\plugin-selection.ini" "plugins" "imu-attitude"
  ReadINIStr $PluginMemory "$INSTDIR\resources\plugin-selection.ini" "plugins" "memory-image"
  ReadINIStr $PluginTemplate "$INSTDIR\resources\plugin-selection.ini" "plugins" "pnx-template"
  ReadINIStr $PluginSystemId "$INSTDIR\resources\plugin-selection.ini" "plugins" "system-identification"
  ClearErrors
  ReadINIStr $0 "$INSTDIR\resources\plugin-selection.ini" "plugins" "embedded-setup"
  IfErrors +2 0
  StrCpy $PluginSetup $0
  done:
FunctionEnd

!macro customInit
  Call ReadPluginSelection
!macroend

!macro customPageAfterChangeDir
  Page custom PluginSelectionPage PluginSelectionLeave
!macroend

Function PluginSelectionPage
  # Also honour a previous installation at a directory selected on the prior page.
  Call ReadPluginSelection
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "选择要安装的可选插件（更新时保留选择）。$\r$\nChoose optional plugins to install; updates keep your choices."
  Pop $0
  ${NSD_CreateCheckbox} 4u 30u 95% 12u "CSV Recorder"
  Pop $PluginCsvControl
  ${NSD_SetState} $PluginCsvControl $PluginCsv
  ${NSD_CreateCheckbox} 4u 48u 95% 12u "IMU Attitude"
  Pop $PluginImuControl
  ${NSD_SetState} $PluginImuControl $PluginImu
  ${NSD_CreateCheckbox} 4u 66u 95% 12u "Memory Image Viewer"
  Pop $PluginMemoryControl
  ${NSD_SetState} $PluginMemoryControl $PluginMemory
  ${NSD_CreateCheckbox} 4u 84u 95% 12u "PnX Template Configuration"
  Pop $PluginTemplateControl
  ${NSD_SetState} $PluginTemplateControl $PluginTemplate
  ${NSD_CreateCheckbox} 4u 102u 95% 12u "Gimbal System Identification"
  Pop $PluginSystemIdControl
  ${NSD_SetState} $PluginSystemIdControl $PluginSystemId
  ${NSD_CreateCheckbox} 4u 120u 95% 12u "Embedded Environment Setup"
  Pop $PluginSetupControl
  ${NSD_SetState} $PluginSetupControl $PluginSetup
  nsDialogs::Show
FunctionEnd

Function PluginSelectionLeave
  ${NSD_GetState} $PluginCsvControl $PluginCsv
  ${NSD_GetState} $PluginImuControl $PluginImu
  ${NSD_GetState} $PluginMemoryControl $PluginMemory
  ${NSD_GetState} $PluginTemplateControl $PluginTemplate
  ${NSD_GetState} $PluginSystemIdControl $PluginSystemId
  ${NSD_GetState} $PluginSetupControl $PluginSetup
FunctionEnd

!macro customInstall
  CreateDirectory "$INSTDIR\resources"
  WriteINIStr "$INSTDIR\resources\plugin-selection.ini" "plugins" "csv-recorder" "$PluginCsv"
  WriteINIStr "$INSTDIR\resources\plugin-selection.ini" "plugins" "imu-attitude" "$PluginImu"
  WriteINIStr "$INSTDIR\resources\plugin-selection.ini" "plugins" "memory-image" "$PluginMemory"
  WriteINIStr "$INSTDIR\resources\plugin-selection.ini" "plugins" "pnx-template" "$PluginTemplate"
  WriteINIStr "$INSTDIR\resources\plugin-selection.ini" "plugins" "system-identification" "$PluginSystemId"
  WriteINIStr "$INSTDIR\resources\plugin-selection.ini" "plugins" "embedded-setup" "$PluginSetup"
  ${If} $PluginCsv != ${BST_CHECKED}
    RMDir /r "$INSTDIR\resources\plugins\csv-recorder"
  ${EndIf}
  ${If} $PluginImu != ${BST_CHECKED}
    RMDir /r "$INSTDIR\resources\plugins\imu-attitude"
  ${EndIf}
  ${If} $PluginMemory != ${BST_CHECKED}
    RMDir /r "$INSTDIR\resources\plugins\memory-image"
  ${EndIf}
  ${If} $PluginTemplate != ${BST_CHECKED}
    RMDir /r "$INSTDIR\resources\plugins\pnx-template"
  ${EndIf}
  ${If} $PluginSetup != ${BST_CHECKED}
    RMDir /r "$INSTDIR\resources\plugins\embedded-setup"
  ${EndIf}
  ${If} $PluginSystemId != ${BST_CHECKED}
    RMDir /r "$INSTDIR\resources\plugins\system-identification"
  ${EndIf}
!macroend
!endif
