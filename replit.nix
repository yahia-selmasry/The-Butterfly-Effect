{ pkgs }: {
  deps = [
    pkgs.python311
    pkgs.python311Packages.flask
    pkgs.python311Packages.flask-login
    pkgs.python311Packages.werkzeug
    pkgs.python311Packages.gunicorn
    pkgs.python311Packages.psycopg2
  ];
}
