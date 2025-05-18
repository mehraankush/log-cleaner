import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import glob from 'glob';

// Convert fs and glob methods to Promise-based
const readFilePromise = (filePath: string): Promise<string> => {
	return new Promise((resolve, reject) => {
		fs.readFile(filePath, 'utf8', (err, data) => {
			if (err) {
				reject(err);
			} else {
				resolve(data);
			}
		});
	});
};

const writeFilePromise = (filePath: string, data: string): Promise<void> => {
	return new Promise((resolve, reject) => {
		fs.writeFile(filePath, data, 'utf8', (err) => {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
};

const globPromise = (pattern: string, options: glob.IOptions): Promise<string[]> => {
	return new Promise((resolve, reject) => {
		glob(pattern, options, (err: Error | null, files: string[]) => {
			if (err) {
				reject(err);
			} else {
				resolve(files);
			}
		});
	});
};

export function activate(context: vscode.ExtensionContext) {
	console.log('Log Cleaner extension is now active');

	// Command to remove logs from the entire workspace
	const removeAllLogsCommand = vscode.commands.registerCommand('log-cleaner.clean', async () => {
		try {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders) {
				vscode.window.showErrorMessage('No workspace folder found. Please open a folder first.');
				return;
			}

			const choice = await vscode.window.showWarningMessage(
				'This will remove all logging statements from your codebase. Are you sure?',
				'Yes', 'No'
			);

			if (choice !== 'Yes') {
				return;
			}

			// Show progress indicator
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Removing logs from codebase',
				cancellable: true
			}, async (progress, token) => {
				const rootPath = workspaceFolders[0].uri.fsPath;
				let totalFilesProcessed = 0;
				let totalLogsRemoved = 0;

				try {
					const config = vscode.workspace.getConfiguration('logCleaner');
					const fileExtensions = config.get<string[]>('fileExtensions') || [];
					const excludeFolders = config.get<string[]>('excludeFolders') || [];

					// Create glob patterns for each file extension
					const filePatterns = fileExtensions.map(ext => `**/*.${ext}`);

					// Create glob ignore patterns for excluded folders
					const ignorePatterns = excludeFolders.map(folder => `**/${folder}/**`);

					// Find all matching files
					let files: string[] = [];

					for (const pattern of filePatterns) {
						const matchedFiles = await globPromise(pattern, {
							cwd: rootPath,
							ignore: ignorePatterns,
							absolute: true
						});
						files = files.concat(matchedFiles);
					}

					const totalFiles = files.length;

					for (let i = 0; i < files.length; i++) {
						if (token.isCancellationRequested) {
							vscode.window.showInformationMessage('Log removal cancelled');
							return;
						}

						const file = files[i];
						const logsRemoved = await removeLogsFromFile(file);
						totalLogsRemoved += logsRemoved;
						totalFilesProcessed++;

						progress.report({
							message: `Processed ${totalFilesProcessed}/${totalFiles} files (${totalLogsRemoved} logs removed)`,
							increment: (1 / totalFiles) * 100
						});
					}

					vscode.window.showInformationMessage(
						`Removed ${totalLogsRemoved} logging statements from ${totalFilesProcessed} files.`
					);
				} catch (error) {
					console.error(error);
					vscode.window.showErrorMessage(`Error processing files: ${error instanceof Error ? error.message : String(error)}`);
				}
			});
		} catch (error) {
			console.error(error);
			vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
		}
	});

	// Command to remove logs from the current file
	const removeLogsInFileCommand = vscode.commands.registerCommand('log-cleaner.cleanFile', async () => {
		try {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage('No active editor found');
				return;
			}

			const document = editor.document;
			const filePath = document.uri.fsPath;

			const logsRemoved = await removeLogsFromFile(filePath);
			vscode.window.showInformationMessage(`Removed ${logsRemoved} logging statements from current file.`);
		} catch (error) {
			console.error(error);
			vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
		}
	});

	context.subscriptions.push(removeAllLogsCommand, removeLogsInFileCommand);
}

async function removeLogsFromFile(filePath: string): Promise<number> {
	try {
		// Read file content
		const content = await readFilePromise(filePath);

		// Get log patterns from settings
		const config = vscode.workspace.getConfiguration('logCleaner');
		const patterns = config.get<string[]>('patterns') || [];

		let newContent = content;
		let totalLogsRemoved = 0;

		// Apply each pattern
		for (const pattern of patterns) {
			try {
				const regex = new RegExp(pattern, 'g');
				const matches = newContent.match(regex);

				if (matches) {
					totalLogsRemoved += matches.length;
					newContent = newContent.replace(regex, '');
				}
			} catch (regexError) {
				console.error(`Invalid regex pattern: ${pattern}`, regexError);
				// Continue with other patterns
			}
		}

		// If content changed, write file
		if (content !== newContent) {
			await writeFilePromise(filePath, newContent);
		}

		return totalLogsRemoved;
	} catch (error) {
		console.error(`Error processing file ${filePath}:`, error);
		return 0;
	}
}

export function deactivate() { }