import { runPreparedStatement } from "../mysql/run-prepared-statement";

const TABLE_NAME = 'request_log_credentials';

const upsertRequestLogPassword = async (hostname: string, password: string): Promise<void> => {
    await runPreparedStatement(
        `
        INSERT INTO ${TABLE_NAME} (hostname, password)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE password = VALUES(password)
        `,
        [hostname, password]
    );
};

const getRequestLogPassword = async (hostname: string): Promise<string | undefined> => {
    const [rows]: any = await runPreparedStatement(
        `
        SELECT password
        FROM ${TABLE_NAME}
        WHERE hostname = ?
        LIMIT 1
        `,
        [hostname]
    );

    if (!rows || rows.length === 0) {
        return undefined;
    }

    return rows[0].password;
};

export { upsertRequestLogPassword, getRequestLogPassword };
