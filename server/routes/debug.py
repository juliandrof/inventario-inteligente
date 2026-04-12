"""Debug endpoint to see app logs in real-time."""

import collections
import logging
from fastapi import APIRouter

router = APIRouter()

# In-memory ring buffer for recent logs
_log_buffer = collections.deque(maxlen=200)


class BufferHandler(logging.Handler):
    def emit(self, record):
        _log_buffer.append(self.format(record))


# Attach to root logger
_handler = BufferHandler()
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S"))
logging.getLogger().addHandler(_handler)


@router.get("/logs")
async def get_logs(n: int = 100):
    """Return last N log lines."""
    lines = list(_log_buffer)[-n:]
    return {"count": len(lines), "logs": lines}
