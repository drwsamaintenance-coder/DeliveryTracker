' Stop DRWSA.vbs
' Double-click this file to shut down the DRWSA server that "Start DRWSA.vbs" launched.
' Note: this stops ALL running node.exe processes on this computer, so close any other
' Node-based apps first if you have them open.

Set shell = CreateObject("WScript.Shell")
shell.Run "taskkill /IM node.exe /F", 0, True
WScript.Echo "DRWSA server stopped."
