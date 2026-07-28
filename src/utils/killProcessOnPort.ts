import { exec } from 'child_process'

export function killProcessOnPort (port, callback) {
  exec(`lsof -t -i:${port}`, (err, stdout, stderr) => {
    if (err) {
      console.error(`Error finding process on port ${port}:`, err)
      return callback(err)
    }
    if (stderr) {
      console.error(`Error finding process on port ${port}:`, stderr)
      return callback(new Error(stderr))
    }
    if (stdout) {
      exec(`kill -9 ${stdout}`, callback)
    } else {
      callback() // Nothing to kill
    }
  })
}
