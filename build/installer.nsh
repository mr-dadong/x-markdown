!macro customInstall
  ; 每次安装（包括同版本覆盖安装）都让应用在下次启动时重新校验并清理渲染缓存。
  ; 这里只删除构建指纹，不删除 LocalStorage、AI 设置或最近文件。
  Delete "$APPDATA\markdown-editor\renderer-build-id.txt"

  ; 注册“打开方式”，但不强制替换用户当前的默认 Markdown 编辑器。
  WriteRegStr HKCU "Software\Classes\XMD.Markdown" "" "Markdown 文档"
  WriteRegStr HKCU "Software\Classes\XMD.Markdown\DefaultIcon" "" '"$INSTDIR\XMD.exe",0'
  WriteRegStr HKCU "Software\Classes\XMD.Markdown\shell\open\command" "" '"$INSTDIR\XMD.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\XMD.exe" "FriendlyAppName" "XMD"
  WriteRegStr HKCU "Software\Classes\Applications\XMD.exe\shell\open\command" "" '"$INSTDIR\XMD.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\XMD.exe\SupportedTypes" ".md" ""
  WriteRegStr HKCU "Software\Classes\Applications\XMD.exe\SupportedTypes" ".markdown" ""
  WriteRegStr HKCU "Software\Classes\Applications\XMD.exe\SupportedTypes" ".txt" ""

  ; ShellNew 需要扩展名能够解析到具名文件类型，否则 Windows 11 可能忽略该菜单项。
  ; UserChoice 仍由 Windows 管理，这里不会覆盖用户已经选择的默认打开程序。
  WriteRegStr HKCU "Software\Classes\.md" "" "XMD.Markdown"
  WriteRegStr HKCU "Software\Classes\.md" "Content Type" "text/markdown"

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
  ; 仅当扩展名仍指向 XMD 时清理，避免破坏安装后由其他软件写入的关联。
  ReadRegStr $0 HKCU "Software\Classes\.md" ""
  StrCmp $0 "XMD.Markdown" 0 +2
  DeleteRegValue HKCU "Software\Classes\.md" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
