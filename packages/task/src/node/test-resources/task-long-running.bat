REM TODO: adapt 'task-long-running' bash script to windows

@echo off
for /l %%x in (1,1,30) do (
   echo tasking... %%x
   timeout /t 1
)