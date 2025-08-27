# コネクシオ株式会社 コーポレートサイト

・PHP8.3
・mysql:5.7　※使用していない

※newsフォルダ以下については、2020年以降をソース管理している。2019年以前については、本番環境またはシェアポイントのバックアップファイルを参照すること

バックアップファイル：https://siance.sharepoint.com/:f:/s/it/EhY3JbAgCM5MqcPzdAumVA4BbJ2HbxzttpoTvp09nd7WbQ?e=9ClJog

## 環境構築

ubuntuのターミナル
```
docker-compose up -d
```

http://localhost:8080/ にアクセス

※htmlとphpを表示できるようにnginx/default.confを編集している

以下、無視してよい

.envをapp/publicにコピー

phpコンテナのターミナル
```
composer update
```
PHPStormでMySQLにアクセスする
* ポート:4306
* ユーザ名:symfony
* パスワード:symfony

本番からDBをダウンロード

PHPStormの symfony_docker　を右クリック　-> SQLスクリプト　->　SQLスクリプトを実行
ダウンロードしたDBのSQLを選択し、実行

終わるまでしばらく待つ

右上のスキーマで　symfony_dockerを選択し、マスクのSQLを実行する
```
UPDATE Administrator SET email = "" where id > 0;
UPDATE Company SET contactEmail = "" where id > 0;
```

ubuntuのターミナル
```
sudo chmod 777 -R ./*
```
localhost:8080にアクセスする
