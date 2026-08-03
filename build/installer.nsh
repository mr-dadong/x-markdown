!macro customInstall
  ; 注册“打开方式”，但不强制替换用户当前的默认 Markdown 编辑器。
  WriteRegStr HKCU "Software\Classes\XMD.Markdown" "" "Markdown 文档"
  WriteRegStr HKCU "Software\Classes\XMD.Markdown\DefaultIcon" "" '"$INSTDIR\XMD.exe",0'
  WriteRegStr HKCU "Software\Classes\XMD.Markdown\shell\open\command" "" '"$INSTDIR\XMD.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\XMD.exe" "FriendlyAppName" "XMD"
  WriteRegStr HKCU "Software\Classes\Applications\XMD.exe\shell\open\command" "" '"$INSTDIR\XMD.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\XMD.exe\SupportedTypes" ".md" ""
  WriteRegStr HKCU "Software\Classes\Applications\XMD.exe\SupportedTypes" ".markdown" ""
  WriteRegStr HKCU "Software\Classes\Applications\XMD.exe\SupportedTypes" ".txt" ""

  ; 在支持的文件右键菜单中增加“使用 XMD 打开”快捷入口。
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.md\shell\XMD" "" "使用 XMD 打开"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.md\shell\XMD" "Icon" '"$INSTDIR\XMD.exe",0'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.md\shell\XMD\command" "" '"$INSTDIR\XMD.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.markdown\shell\XMD" "" "使用 XMD 打开"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.markdown\shell\XMD" "Icon" '"$INSTDIR\XMD.exe",0'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.markdown\shell\XMD\command" "" '"$INSTDIR\XMD.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.txt\shell\XMD" "" "使用 XMD 打开"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.txt\shell\XMD" "Icon" '"$INSTDIR\XMD.exe",0'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.txt\shell\XMD\command" "" '"$INSTDIR\XMD.exe" "%1"'

  WriteRegStr HKCU "Software\Classes\.md\OpenWithProgids" "XMD.Markdown" ""
  WriteRegStr HKCU "Software\Classes\.markdown\OpenWithProgids" "XMD.Markdown" ""
  WriteRegStr HKCU "Software\Classes\.txt\OpenWithProgids" "XMD.Markdown" ""

  ; 注册 Windows 资源管理器“右键 -> 新建”菜单，创建一个空的 Markdown 文件。
  ; 仅注册常用的 .md 扩展名，避免 .md 和 .markdown 在“新建”菜单中重复出现。
  WriteRegStr HKCU "Software\Classes\.md\ShellNew" "NullFile" ""

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ; 卸载时同步清理右键菜单和“打开方式”记录。
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.md\shell\XMD"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.markdown\shell\XMD"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.txt\shell\XMD"
  DeleteRegKey HKCU "Software\Classes\Applications\XMD.exe"
  DeleteRegKey HKCU "Software\Classes\XMD.Markdown"
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "XMD.Markdown"
  DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "XMD.Markdown"
  DeleteRegValue HKCU "Software\Classes\.txt\OpenWithProgids" "XMD.Markdown"
  ; 只删除 XMD 写入的值，避免误删其他软件在 ShellNew 下保存的配置。
  DeleteRegValue HKCU "Software\Classes\.md\ShellNew" "NullFile"
  DeleteRegKey /ifempty HKCU "Software\Classes\.md\ShellNew"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
