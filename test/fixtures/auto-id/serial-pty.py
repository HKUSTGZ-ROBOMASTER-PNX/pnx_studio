"""Exercise the actual Rust serial bridge using a local pseudo-terminal, without hardware."""
import json
import os
import pty
import select
import subprocess
import sys
import tempfile
from pathlib import Path

adapter = sys.argv[1]
header = 'time_ms,yaw_pos_ref_rad,yaw_pos_fdb_rad,yaw_speed_fdb_rad_s,yaw_current_cmd,yaw_current_saturated'

def command(master, expected):
    ready, _, _ = select.select([master], [], [], 5)
    assert ready, f'timed out waiting for {expected!r}'
    payload = os.read(master, 4096)
    assert expected in payload, repr(payload)

def run(mode):
    master, slave = pty.openpty()
    try:
        with tempfile.TemporaryDirectory(prefix='auto-id-serial-test-') as directory:
            output = Path(directory) / 'raw.csv'
            process = subprocess.Popen([adapter, '--auto-id-capture', '--port', os.ttyname(slave), '--baud', '921600', '--output', str(output)],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                command(master, b'AUTO_ID_START\r\n')
                os.write(master, f'#AUTO_ID_START,pitch_rad=0,T=40,buffer_ratio=0.2\r\n{header}\r\n10,0,0,0.2,100,0\r\n'.encode())
                assert json.loads(process.stdout.readline())['type'] == 'started'
                if mode == 'finish':
                    os.write(master, b'#AUTO_ID_STATS,samples=1,dropped=0\r\n#AUTO_ID_END\r\n')
                elif mode == 'abort':
                    process.stdin.write(b'abort\n')
                    process.stdin.flush()
                    command(master, b'AUTO_ID_ABORT\r\n')
                    os.write(master, b'#AUTO_ID_ABORTED\r\n')
                else:
                    process.stdin.close()
                    command(master, b'AUTO_ID_ABORT\r\n')
                    if mode == 'eof': os.write(master, b'#AUTO_ID_ABORTED\r\n')
                event = json.loads(process.stdout.readline())
                assert process.wait(timeout=5) == (1 if mode == 'unconfirmed' else 0)
                if mode == 'unconfirmed':
                    assert event['type'] == 'error' and 'did not acknowledge' in event['message'] and 'stop is unconfirmed' in event['message'], event
                else:
                    assert event['type'] == ('finished' if mode == 'finish' else 'aborted'), event
                    assert event['samples'] == 1
                assert output.read_text() == header + '\n10,0,0,0.2,100,0\n'
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
    finally:
        os.close(master)
        os.close(slave)

for case in ['finish', 'abort', 'eof', 'unconfirmed']:
    run(case)
print('capture, abort, EOF and unconfirmed abort passed')
