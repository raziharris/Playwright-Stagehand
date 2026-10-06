class LiveReporter {
  onTestBegin(test) {
    process.stdout.write(`QA_EVENT:${JSON.stringify({ kind: 'begin', file: test.location.file, title: test.title })}\n`);
  }
  onTestEnd(test, result) {
    process.stdout.write(`QA_EVENT:${JSON.stringify({ kind: 'end', file: test.location.file, title: test.title, status: result.status, duration: result.duration, error: result.error?.message })}\n`);
  }
}
module.exports = LiveReporter;
