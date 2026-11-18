"""Regenerate original public-snapshot artwork and icons."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('sanitize-public-snapshot.py')),run_name='__main__')

