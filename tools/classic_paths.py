"""Portable client default; setup also accepts an explicit --client path."""
import os
from pathlib import Path
DEFAULT_CLASSIC=Path(os.environ.get('UO_CLIENT_PATH') or (Path(os.environ.get('ProgramFiles(x86)', 'Program Files (x86)'))/'Electronic Arts'/'Ultima Online Classic'))
